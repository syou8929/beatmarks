import { describe, expect, it } from "vitest";

import { deriveGrid } from "../../shared/deriveGrid.js";
import { FPS_PRESETS } from "../../shared/timebase.js";
import type { AnalysisResult } from "../../shared/types.js";
import { defaultEditState } from "../../shared/validate.js";
import { nudgeSec, snapSec } from "../editor/snap.js";
import type { TimeCtx } from "../editor/timeFormat.js";

function ctx(): TimeCtx {
  const a: AnalysisResult = {
    durationSec: 20, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0,
    beats: Array.from({ length: 40 }, (_, i) => i * 0.5), downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [], hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
  };
  return { fps: FPS_PRESETS["30"]!, grid: deriveGrid(a, defaultEditState()) };
}

describe("snapSec", () => {
  const c = ctx();
  it("beat: 最近傍の拍(0.5s間隔)", () => {
    expect(snapSec(0.6, "beat", c)).toBeCloseTo(0.5, 6);
    expect(snapSec(0.8, "beat", c)).toBeCloseTo(1.0, 6);
  });
  it("beat: 等距離タイは早い方(小さい時刻)", () => {
    expect(snapSec(0.75, "beat", c)).toBeCloseTo(0.5, 6);
  });
  it("bar: 最近傍の小節(2s間隔)", () => {
    expect(snapSec(2.9, "bar", c)).toBeCloseTo(2.0, 6);
    expect(snapSec(3.1, "bar", c)).toBeCloseTo(4.0, 6);
  });
  it("frame: 30fps グリッド(1/30秒)へ丸め", () => {
    expect(snapSec(0.02, "frame", c)).toBeCloseTo(1 / 30, 6); // 0.02→round(0.6f)=1f
    expect(snapSec(0.01, "frame", c)).toBeCloseTo(0, 6);
  });
  it("none: 恒等", () => {
    expect(snapSec(1.2345, "none", c)).toBe(1.2345);
  });
  it("グリッド空でも beat/bar は恒等(スナップ先なし)", () => {
    const empty: TimeCtx = { fps: c.fps, grid: [] };
    expect(snapSec(1.2, "beat", empty)).toBe(1.2);
    expect(snapSec(1.2, "bar", empty)).toBe(1.2);
  });
});

describe("nudgeSec", () => {
  it("fine=true は ±1ms、fine=false は ±10ms", () => {
    expect(nudgeSec(1.0, 1, true)).toBeCloseTo(1.001, 6);
    expect(nudgeSec(1.0, -1, true)).toBeCloseTo(0.999, 6);
    expect(nudgeSec(1.0, 1, false)).toBeCloseTo(1.01, 6);
    expect(nudgeSec(1.0, -1, false)).toBeCloseTo(0.99, 6);
  });
});
