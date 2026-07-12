import { describe, expect, it } from "vitest";

import { deriveGrid, barsOf } from "../deriveGrid.js";
import { defaultEditState } from "../validate.js";
import type { AnalysisResult, EditState } from "../types.js";

/** 固定120BPM・オフセット0.25s・10秒(拍0.25,0.75,…,9.75 の20拍)の合成解析結果 */
function fixedAnalysis(): AnalysisResult {
  const beats = Array.from({ length: 20 }, (_, i) => 0.25 + i * 0.5);
  return {
    durationSec: 10,
    tempoMode: "fixed",
    bpm: 120,
    gridOffsetSec: 0.25,
    beats,
    downbeatPhase: 0,
    tempoMap: [{ timeSec: 0, bpm: 120 }],
    key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [],
    hits: [],
    silences: [],
    envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
  };
}

function edits(over: Partial<EditState> = {}): EditState {
  return { ...defaultEditState(), ...over };
}

describe("deriveGrid 基本", () => {
  it("編集なし: 4/4で位相0、小節頭は0.25/2.25/4.25…", () => {
    const grid = deriveGrid(fixedAnalysis(), edits());
    expect(grid).toHaveLength(20);
    const bars = barsOf(grid);
    expect(bars.map((b) => b.timeSec)).toEqual([0.25, 2.25, 4.25, 6.25, 8.25]);
    expect(bars.map((b) => b.barNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(grid[1]!.isBar).toBe(false);
    expect(grid[1]!.barNumber).toBe(1); // 小節1内の拍
    expect(grid.every((b) => !b.free)).toBe(true);
  });

  it("gridOffsetDeltaSecで全拍がシフト", () => {
    const grid = deriveGrid(fixedAnalysis(), edits({ gridOffsetDeltaSec: 0.1 }));
    expect(grid[0]!.timeSec).toBeCloseTo(0.35, 9);
    expect(grid).toHaveLength(20); // 9.85 < 10 なので落ちない
  });

  it("downbeatShiftで小節頭が1拍ずれる", () => {
    const bars = barsOf(deriveGrid(fixedAnalysis(), edits({ downbeatShift: 1 })));
    expect(bars[0]!.timeSec).toBeCloseTo(0.75, 9);
  });

  it("beatsPerBar=3で3拍ごとの小節頭", () => {
    const bars = barsOf(deriveGrid(fixedAnalysis(), edits({ beatsPerBar: 3 })));
    expect(bars.map((b) => b.timeSec).slice(0, 3)).toEqual([0.25, 1.75, 3.25]);
  });

  it("bpmOverride=240で拍数が倍になる", () => {
    const grid = deriveGrid(fixedAnalysis(), edits({ bpmOverride: 240 }));
    expect(grid.length).toBe(39); // 0.25 + k*0.25 < 10 → k=0..38
    expect(grid[1]!.timeSec).toBeCloseTo(0.5, 9);
  });

  it("負のdownbeatShiftも正規化される", () => {
    const bars = barsOf(deriveGrid(fixedAnalysis(), edits({ downbeatShift: -1 })));
    // phase (0-1) mod 4 = 3 → 最初の小節頭は index3 = 1.75
    expect(bars[0]!.timeSec).toBeCloseTo(1.75, 9);
  });
});

describe("小節1アンカー", () => {
  it("アンカー位置の拍が小節1・拍1になり前は小節0以下", () => {
    const grid = deriveGrid(
      fixedAnalysis(),
      edits({ gridAnchor: { timeSec: 4.3, freeBefore: false } }),
    );
    const anchor = grid.find((b) => b.barNumber === 1 && b.isBar)!;
    expect(anchor.timeSec).toBeCloseTo(4.25, 9); // 4.3に最も近い拍
    const before = grid.filter((b) => b.timeSec < 4.25 && b.isBar);
    expect(before.map((b) => b.barNumber)).toEqual([-1, 0]); // 0.25=小節-1, 2.25=小節0
    expect(grid.every((b) => !b.free)).toBe(true);
  });

  it("freeBefore=trueでアンカー前がfreeになる", () => {
    const grid = deriveGrid(
      fixedAnalysis(),
      edits({ gridAnchor: { timeSec: 4.3, freeBefore: true } }),
    );
    for (const b of grid) {
      expect(b.free).toBe(b.timeSec < 4.25 - 1e-9);
    }
    expect(barsOf(grid)[0]!.timeSec).toBeCloseTo(4.25, 9);
  });

  it("アンカーはdownbeatShiftより優先される", () => {
    const g1 = deriveGrid(
      fixedAnalysis(),
      edits({ gridAnchor: { timeSec: 4.3, freeBefore: false }, downbeatShift: 2 }),
    );
    expect(g1.find((b) => b.barNumber === 1 && b.isBar)!.timeSec).toBeCloseTo(4.25, 9);
  });
});

describe("可変テンポ", () => {
  it("beatsをそのまま使いbarNumberを振る", () => {
    const a = fixedAnalysis();
    a.tempoMode = "variable";
    a.bpm = null;
    a.beats = [0.5, 1.0, 1.6, 2.3, 3.1, 4.0]; // 不等間隔
    const grid = deriveGrid(a, edits());
    expect(grid.map((b) => b.timeSec)).toEqual(a.beats);
    expect(barsOf(grid).map((b) => b.timeSec)).toEqual([0.5, 3.1]);
  });
});

describe("入力サニタイズ(レビュー強化)", () => {
  it("bpmOverride=Infinityでもハングせずフォールバック", () => {
    const grid = deriveGrid(fixedAnalysis(), edits({ bpmOverride: Infinity }));
    expect(grid.length).toBeGreaterThan(0);
    expect(grid.length).toBeLessThan(2000); // 10秒×6000BPM上限=1000拍以内
  });

  it("bpmOverride=NaN/負は上書きなし扱い", () => {
    expect(deriveGrid(fixedAnalysis(), edits({ bpmOverride: NaN }))).toHaveLength(20);
    expect(deriveGrid(fixedAnalysis(), edits({ bpmOverride: -5 }))).toHaveLength(20);
  });

  it("小数のdownbeatShiftは丸められ、小節が消えない", () => {
    const bars = barsOf(deriveGrid(fixedAnalysis(), edits({ downbeatShift: 0.5 })));
    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0]!.timeSec).toBeCloseTo(0.75, 9); // round(0.5)=1 相当
  });

  it("beatsPerBar=NaNは4/4扱い", () => {
    const bars = barsOf(deriveGrid(fixedAnalysis(), edits({ beatsPerBar: NaN })));
    expect(bars.map((b) => b.timeSec)).toEqual([0.25, 2.25, 4.25, 6.25, 8.25]);
  });
});
