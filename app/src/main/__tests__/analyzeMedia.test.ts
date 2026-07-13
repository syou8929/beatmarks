import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AnalyzeProgressEvent } from "../../shared/ipc.js";
import type { AnalysisResult } from "../../shared/types.js";
import { AnalyzeCancelledError, createAnalyzer } from "../analyzeMedia.js";
import { ffmpegPath } from "../paths.js";

const dir = mkdtempSync(join(tmpdir(), "bmam-"));
const STEREO_WAV = join(dir, "in.wav");

beforeAll(() => {
  execFileSync(ffmpegPath(), [
    "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-ac", "2", "-ar", "44100", STEREO_WAV,
  ]);
}, 30_000);

function fakeAnalysis(): AnalysisResult {
  return {
    durationSec: 2, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0,
    beats: [0, 0.5, 1, 1.5], downbeatPhase: 0,
    tempoMap: [{ timeSec: 0, bpm: 120 }],
    key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [], hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
  };
}

function fakeEngine() {
  return {
    analyze: vi.fn(async (_path: string, onProgress?: (ev: { stage: string; percent: number }) => void) => {
      onProgress?.({ stage: "load", percent: 0 });
      onProgress?.({ stage: "done", percent: 100 });
      return { analysis: fakeAnalysis(), warnings: ["short-audio"] };
    }),
    cancelCurrent: vi.fn(async () => {}),
  };
}

describe("analyzeMedia", () => {
  it("mono mixで1ソースのAnalyzedProjectを組み立てる", async () => {
    const events: AnalyzeProgressEvent[] = [];
    const engine = fakeEngine();
    const a = createAnalyzer({ engine: engine as never, emitProgress: (ev) => events.push(ev) });
    const p = await a.analyzeMedia({
      filePath: STEREO_WAV,
      input: { mode: "mix", trackIndexes: [0], channelSplit: "mono" },
    });
    expect(p.baseName).toBe("in");
    expect(p.sources).toHaveLength(1);
    expect(p.sources[0]!.source.label).toBe("2mix");
    expect(p.sources[0]!.warnings).toEqual(["short-audio"]);
    expect(p.mediaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.durationSec).toBeCloseTo(2, 1);
    // 進捗: extract → load → done がソース情報付きで届く
    expect(events[0]!.stage).toBe("extract");
    expect(events.some((e) => e.stage === "done")).toBe(true);
    expect(events.every((e) => e.sourceCount === 1 && e.sourceLabel === "2mix")).toBe(true);
    // エンジンには解析用WAV(22.05k)のパスが渡っている
    expect(engine.analyze).toHaveBeenCalledTimes(1);
    expect(String(engine.analyze.mock.calls[0]![0])).toMatch(/src-mix\.wav$/);
  });

  it("stereo-splitで2ソース・進捗のsourceIndexが進む", async () => {
    const events: AnalyzeProgressEvent[] = [];
    const a = createAnalyzer({ engine: fakeEngine() as never, emitProgress: (ev) => events.push(ev) });
    const p = await a.analyzeMedia({
      filePath: STEREO_WAV,
      input: { mode: "mix", trackIndexes: [0], channelSplit: "stereo-split" },
    });
    expect(p.sources.map((s) => s.source.label)).toEqual(["L", "R"]);
    expect(new Set(events.map((e) => e.sourceIndex))).toEqual(new Set([0, 1]));
    expect(events.every((e) => e.sourceCount === 2)).toBe(true);
  });

  it("cancel()で以後のソースが処理されずAnalyzeCancelledError", async () => {
    const engine = fakeEngine();
    let cancelFn: (() => Promise<void>) | null = null;
    engine.analyze.mockImplementationOnce(async (_p, onProgress) => {
      onProgress?.({ stage: "load", percent: 0 });
      await cancelFn!(); // 1ソース目の解析中にキャンセル発火
      return { analysis: fakeAnalysis(), warnings: [] };
    });
    const a = createAnalyzer({ engine: engine as never, emitProgress: () => {} });
    cancelFn = a.cancel;
    await expect(
      a.analyzeMedia({
        filePath: STEREO_WAV,
        input: { mode: "mix", trackIndexes: [0], channelSplit: "stereo-split" },
      }),
    ).rejects.toThrow(AnalyzeCancelledError);
    expect(engine.analyze).toHaveBeenCalledTimes(1); // 2ソース目に進まない
    expect(engine.cancelCurrent).toHaveBeenCalled();
  });
});
