import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { deriveMarkers } from "../deriveMarkers.js";
import { runExport, TEXT_EXPORTERS, type TextTargetKey } from "../exporters/index.js";
import { embedWavCues } from "../exporters/wavCues.js";
import { ExportError } from "../exporters/helpers.js";
import { TARGETS } from "../naming.js";
import { FPS_PRESETS } from "../timebase.js";
import { defaultEditState, parseEngineResult } from "../validate.js";
import type { ExportContext, Marker } from "../types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "golden");
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

// ---- fixture から現実的なマーカー列を作る(編集も少し混ぜる) ----
const engine = parseEngineResult(
  readFileSync(join(HERE, "..", "__fixtures__", "analysis-30s.json"), "utf-8"),
);
const edits = {
  ...defaultEditState(),
  hitThreshold: { low: 0.5, mid: 0.5, high: 0.5 }, // ヒットを間引いてゴールデンを読みやすく
  sectionEdits: [{ op: "rename" as const, index: 0, label: "イントロ" }],
  customMarkers: [{
    id: "custom-1", sourceId: "mix", timeSec: 7.5, type: "custom" as const,
    label: "カメラフラッシュ", color: "#ffd166", source: "user" as const,
  }],
};
const markers: Marker[] = deriveMarkers(engine.analysis, edits, "mix");

function ctxFor(fpsKey: "30" | "29.97"): ExportContext {
  return {
    fps: FPS_PRESETS[fpsKey]!, rounding: "nearest",
    include: ["section", "bar", "hit", "silence", "custom"], // beatは多いので除外
    baseName: "fixture30", sourceLabel: null, audioFileName: "fixture30.wav",
    audioDurationSec: engine.analysis.durationSec,
    bpmLabel: engine.analysis.bpm ? engine.analysis.bpm.toFixed(2) : "可変",
    keyLabel: `${engine.analysis.key.global.name} (${engine.analysis.key.global.camelot})`,
    beatsPerBar: 4, timeSigDenominator: 4, tempoMap: engine.analysis.tempoMap,
    envelopes: engine.analysis.envelopes,
  };
}

function checkGolden(name: string, content: string | Uint8Array): void {
  const isText = typeof content === "string";
  const path = join(GOLDEN, name);
  if (UPDATE) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(path, isText ? content : sha256(content));
    return;
  }
  expect(existsSync(path), `golden missing: ${name}(UPDATE_GOLDEN=1 で生成)`).toBe(true);
  const expected = readFileSync(path, "utf-8");
  expect(isText ? content : sha256(content)).toBe(expected);
}

function sha256(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

describe("統合ゴールデン(fixture→derive→全エクスポータ)", () => {
  const textTargets = Object.keys(TEXT_EXPORTERS) as TextTargetKey[];

  for (const fpsKey of ["30", "29.97"] as const) {
    for (const target of textTargets) {
      it(`${target} @${fpsKey}fps`, () => {
        const { fileName, data } = runExport(target, markers, ctxFor(fpsKey));
        expect(fileName).toContain(TARGETS[target].abbr);
        checkGolden(`${target}-${fpsKey}.${TARGETS[target].ext}`, data);
      });
    }
    it(`midi @${fpsKey}fps`, () => {
      const { data } = runExport("midi", markers, ctxFor(fpsKey));
      expect((data as Uint8Array).length).toBeGreaterThan(100);
      checkGolden(`midi-${fpsKey}.sha256`, data as Uint8Array);
    });
  }

  it("wavcues(決定的な合成WAVに埋め込み)", () => {
    // 22050Hz/1chの無音WAVをテスト内で決定的に構築
    const sr = 22050;
    const n = Math.round(engine.analysis.durationSec * sr);
    const header = new Uint8Array(44 + n * 2);
    const dv = new DataView(header.buffer);
    const w = (o: number, s: string) => [...s].forEach((c, i) => header[o + i] = c.charCodeAt(0));
    w(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); w(8, "WAVE");
    w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    w(36, "data"); dv.setUint32(40, n * 2, true);
    const out = embedWavCues(header, markers, ctxFor("30"));
    checkGolden("wavcues.sha256", out);
  });

  it("wavcues を runExport に渡すと ExportError(embedWavCues直接使用へ誘導)", () => {
    expect(() => runExport("wavcues", markers, ctxFor("30"))).toThrow(ExportError);
  });

  it("マーカー導出はfixtureに対して安定", () => {
    expect(markers.length).toBeGreaterThan(10);
    const again = deriveMarkers(engine.analysis, edits, "mix");
    expect(again).toEqual(markers);
  });
});
