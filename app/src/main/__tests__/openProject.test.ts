import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { openProjectFlow, type OpenProjectDeps } from "../openProject.js";
import type { ProjectFileState } from "../../shared/ipc.js";
import { defaultEditState, parseEngineResult } from "../../shared/validate.js";

const engine = parseEngineResult(
  readFileSync(join(__dirname, "..", "..", "shared", "__fixtures__", "analysis-30s.json"), "utf-8"),
);
const dir = mkdtempSync(join(tmpdir(), "bmopen-"));
function state(hash: string): ProjectFileState {
  return {
    version: 1, mediaPath: "/m/t.mp4", mediaHash: hash, baseName: "t", durationSec: 30,
    input: { mode: "mix", trackIndexes: [0], channelSplit: "mono" },
    sources: [{ source: { id: "mix", kind: "mix", label: "2mix" }, analysis: engine.analysis, edits: defaultEditState() }],
    activeSourceId: "mix", ui: { fps: { num: 30, den: 1 }, rounding: "nearest" },
  };
}
function deps(over: Partial<OpenProjectDeps> = {}): OpenProjectDeps {
  return {
    readProject: async () => state("HASH"),
    exists: () => true,
    extractPlaybackWav: async (_m, _t, out) => writeFileSync(out, "wavbytes"),
    hashFile: async () => "HASH",
    jobDir: () => dir,
    ...over,
  };
}

describe("openProjectFlow", () => {
  it("ハッシュ一致で ok:true, hashMismatch:false, playbackWavPath 返却", async () => {
    const r = await openProjectFlow("/p.bmk", deps());
    expect(r).toMatchObject({ ok: true, hashMismatch: false, path: "/p.bmk" });
    if (r.ok) expect(r.playbackWavPath.endsWith("playback.wav")).toBe(true);
  });
  it("ハッシュ不一致でも ok:true・hashMismatch:true(続行判断はrenderer)", async () => {
    const r = await openProjectFlow("/p.bmk", deps({ hashFile: async () => "DIFFERENT" }));
    expect(r).toMatchObject({ ok: true, hashMismatch: true });
  });
  it("mediaPath 不在は ok:false", async () => {
    const r = await openProjectFlow("/p.bmk", deps({ exists: () => false }));
    expect(r.ok).toBe(false);
  });
  it("読込失敗は ok:false", async () => {
    const r = await openProjectFlow("/p.bmk", deps({ readProject: async () => { throw new Error("bad"); } }));
    expect(r).toMatchObject({ ok: false });
  });

  // 台帳追加要件(Task10レビュー): wavcues 非WAV抽出が [0] 固定だった問題を解消するため、
  // .bmk に永続化した InputConfig.trackIndexes を再オープン時の再抽出にも使う。
  it("永続化された input.trackIndexes を [0] 固定にせず extractPlaybackWav に渡す(台帳追加要件)", async () => {
    const calls: number[][] = [];
    const custom: ProjectFileState = {
      ...state("HASH"),
      input: { mode: "mix", trackIndexes: [2], channelSplit: "mono" },
    };
    const r = await openProjectFlow("/p.bmk", deps({
      readProject: async () => custom,
      extractPlaybackWav: async (_m, t, out) => { calls.push(t); writeFileSync(out, "wavbytes"); },
    }));
    expect(r.ok).toBe(true);
    expect(calls).toEqual([[2]]);
  });

  it("実ffmpeg: 生成wavを再抽出しハッシュ照合(改ざんで mismatch)", async () => {
    const { extractPlaybackWav } = await import("../ffmpeg.js");
    const media = join(dir, "silence.wav");
    // ffmpeg で 1秒の無音WAVを媒体として用意
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "1", media]);
    const hashFile = async (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
    const real: OpenProjectDeps = {
      readProject: async () => ({ ...state(""), mediaPath: media }),
      exists: () => true, extractPlaybackWav, hashFile, jobDir: () => dir,
    };
    const first = await openProjectFlow("/p.bmk", real);
    if (!first.ok) throw new Error("expected ok");
    const good = await hashFile(first.playbackWavPath);
    const okRun = await openProjectFlow("/p.bmk", { ...real, readProject: async () => ({ ...state(good), mediaPath: media }) });
    expect(okRun).toMatchObject({ ok: true, hashMismatch: false });
    const badRun = await openProjectFlow("/p.bmk", { ...real, readProject: async () => ({ ...state("00"), mediaPath: media }) });
    expect(badRun).toMatchObject({ ok: true, hashMismatch: true });
  });
});
