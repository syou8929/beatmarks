import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

import { writeExports, type ExportWriterDeps } from "../exportWriter.js";
import type { ExportRequest, InputConfig, ProjectFileState } from "../../shared/ipc.js";
import type { EditState } from "../../shared/types.js";
import { defaultEditState, parseEngineResult } from "../../shared/validate.js";

const HERE = mkdtempSync(join(tmpdir(), "bmexport-"));
const engine = parseEngineResult(
  readFileSync(join(__dirname, "..", "..", "shared", "__fixtures__", "analysis-30s.json"), "utf-8"),
);

/** 決定的な 22050Hz/1ch 無音WAVを bytes で作る(integration-golden と同方式)。 */
function silentWav(durationSec: number): Uint8Array {
  const sr = 22050;
  const n = Math.round(durationSec * sr);
  const b = new Uint8Array(44 + n * 2);
  const dv = new DataView(b.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); w(8, "WAVE");
  w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, n * 2, true);
  return b;
}

const DEFAULT_INPUT: InputConfig = { mode: "mix", trackIndexes: [0], channelSplit: "mono" };

function projectState(
  edits: EditState = defaultEditState(),
  mediaPath = "/media/track.mp4",
  sources = 1,
  input: InputConfig = DEFAULT_INPUT,
): ProjectFileState {
  const srcArr = Array.from({ length: sources }, (_, i) => ({
    source: { id: `mix${i}`, kind: "mix" as const, label: sources > 1 ? "same" : "2mix" },
    analysis: engine.analysis, edits,
  }));
  return {
    version: 1, mediaPath, mediaHash: "a".repeat(64), baseName: "track",
    durationSec: engine.analysis.durationSec, input, sources: srcArr, activeSourceId: "mix0",
    ui: { fps: { num: 30, den: 1 }, rounding: "nearest" },
  };
}

function req(over: Partial<ExportRequest>): ExportRequest {
  return {
    targets: ["json"], sourceIds: ["mix0"], fps: { num: 30, den: 1 }, rounding: "nearest",
    include: ["section", "bar", "hit", "custom"], includeEnvelopes: true,
    destDir: mkdtempSync(join(tmpdir(), "bmdest-")), projectState: projectState(), ...over,
  };
}

const realDeps: ExportWriterDeps = {
  readFile: async (p) => new Uint8Array(await readFile(p)),
  writeFile: (p, d) => writeFile(p, typeof d === "string" ? d : Buffer.from(d)),
  extractWavForCues: async () => { throw new Error("not used"); },
  tmpWavPath: () => join(HERE, `cues-${Math.random()}.wav`),
};

describe("writeExports", () => {
  it("json/csv/midi を実ファイルに書き、パース可能", async () => {
    const r = req({ targets: ["json", "csv", "midi"] });
    const res = await writeExports(r, realDeps);
    expect(res.failed).toEqual([]);
    expect(res.written).toHaveLength(3);
    const jsonPath = res.written.find((p) => p.endsWith(".json"))!;
    expect(() => JSON.parse(readFileSync(jsonPath, "utf-8"))).not.toThrow();
  });

  it("同一ラベルの2ソース×同一ターゲットでファイル名を dedup(-2)", async () => {
    const r = req({ targets: ["json"], sourceIds: ["mix0", "mix1"], projectState: projectState(defaultEditState(), "/media/track.mp4", 2) });
    const res = await writeExports(r, realDeps);
    const names = res.written.map((p) => basename(p)).sort();
    expect(names).toEqual(["track_same_markers-2.json", "track_same_markers.json"]);
  });

  it("wavcues: .wav 入力は元バイトを読み cue チャンクを埋め込む", async () => {
    const wavPath = join(HERE, "src.wav");
    writeFileSync(wavPath, silentWav(engine.analysis.durationSec));
    const r = req({ targets: ["wavcues"], projectState: projectState(defaultEditState(), wavPath) });
    const res = await writeExports(r, realDeps);
    expect(res.failed).toEqual([]);
    const out = readFileSync(res.written[0]!);
    expect(out.includes(Buffer.from("cue "))).toBe(true);
  });

  it("wavcues: 動画入力は extractWavForCues で抽出したWAVに埋め込む(input.trackIndexesを転送)", async () => {
    const calls: number[][] = [];
    const deps: ExportWriterDeps = {
      ...realDeps,
      extractWavForCues: async (_media, trackIndexes, dest) => {
        calls.push(trackIndexes);
        await writeFile(dest, Buffer.from(silentWav(engine.analysis.durationSec)));
      },
    };
    // trackIndexes に既定の[0]ではない値を使い、[0]固定にハードコードされていないことを検証する
    // (台帳追加要件: main/index.ts の extractWavForCues がかつて [0] を決め打ちしていたバグの回帰防止)。
    const customInput: InputConfig = { mode: "mix", trackIndexes: [3], channelSplit: "mono" };
    const r = req({
      targets: ["wavcues"],
      projectState: projectState(defaultEditState(), "/media/clip.mp4", 1, customInput),
    });
    const res = await writeExports(r, deps);
    expect(res.failed).toEqual([]);
    expect(readFileSync(res.written[0]!).includes(Buffer.from("cue "))).toBe(true);
    expect(calls).toEqual([[3]]);
  });

  it("書込失敗は failed[] に落ち、written は空", async () => {
    const notDir = join(HERE, "afile");
    writeFileSync(notDir, "x");
    const r = req({ targets: ["json"], destDir: notDir }); // ファイルを destDir に → ENOTDIR
    const res = await writeExports(r, realDeps);
    expect(res.written).toEqual([]);
    expect(res.failed).toHaveLength(1);
  });

  it("beatsPerBar=6 → MIDI拍子メタの分母が dd=3(=2^3=8)。ハードコード4禁止(台帳必須)", async () => {
    const edits = { ...defaultEditState(), beatsPerBar: 6 };
    const r = req({ targets: ["midi"], include: ["bar"], projectState: projectState(edits) });
    const res = await writeExports(r, realDeps);
    const mid = readFileSync(res.written[0]!);
    const i = mid.indexOf(Buffer.from([0xff, 0x58, 0x04])); // FF 58 04 nn dd cc bb
    expect(i).toBeGreaterThan(0);
    expect(mid[i + 3]).toBe(6); // nn = beatsPerBar
    expect(mid[i + 4]).toBe(3); // dd = log2(8)
  });

  // T12必須指示(台帳・レビューImportant #1): 書き出しの「静黙全滅」チェーンを閉じる。
  // ソース毎セットアップ(buildExportContext/deriveMarkers)は以前 try/catch されておらず、
  // 1ソースの不正データが writeExports 全体を reject させ、既に書けたはずの他ソースの結果まで
  // 消していた。ここでは意図的に壊れた analysis(silences に endSec 欠落相当の不正値)を持つ
  // ソースを混ぜ、他の正常なソースの結果はちゃんと written[] に返ることを検証する。
  it("1ソースの解析データが不正でも他ソースは書き出され、不正ソースは failed[] に落ちる(静黙全滅の回帰)", async () => {
    const goodSource = {
      source: { id: "mix0", kind: "mix" as const, label: "2mix" },
      analysis: engine.analysis, edits: defaultEditState(),
    };
    // envelopes.total を空にすると detectSilencesFromEnvelope 呼び出し自体は例外を投げないため、
    // buildExportContext/deriveMarkers が確実に投げるよう analysis.sections を壊す
    // (deriveMarkers の applySectionEdits は analysis.sections.map(...) を直接読む)。
    const brokenAnalysis = { ...engine.analysis, sections: null as unknown as typeof engine.analysis.sections };
    const badSource = {
      source: { id: "mix1", kind: "mix" as const, label: "broken" },
      analysis: brokenAnalysis, edits: defaultEditState(),
    };
    const r = req({
      targets: ["json"],
      sourceIds: ["mix0", "mix1"],
      projectState: {
        ...projectState(),
        sources: [goodSource, badSource],
        activeSourceId: "mix0",
      },
    });
    const res = await writeExports(r, realDeps);
    expect(res.written).toHaveLength(1);
    expect(basename(res.written[0]!)).toBe("track_2mix_markers.json");
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]!.path).toBe("track_broken_markers.json");
    expect(res.failed[0]!.message).toBeTruthy();
  });
});
