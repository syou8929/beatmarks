import { describe, expect, it } from "vitest";

import { effectiveBpm, formatOffsetMs, keyLabel, parseBpm, timeSigLabel } from "../editor/gridModel.js";
import { defaultEditState } from "../../shared/validate.js";
import { STRINGS } from "../strings.js";
import type { AnalysisResult } from "../../shared/types.js";

function analysis(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    durationSec: 30, tempoMode: "fixed", bpm: 128, gridOffsetSec: 0, beats: [], downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "E minor", camelot: "9A", confidence: 0.86 }, perSection: [] },
    sections: [], hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] }, ...over,
  };
}

describe("gridModel", () => {
  it("effectiveBpm: fixed は analysis.bpm、override 優先、variable は可変テンポ表記(STRINGS.grid.variable)", () => {
    expect(effectiveBpm(analysis(), defaultEditState())).toMatchObject({ label: "128.00", value: 128, fixed: true, overridden: false });
    expect(effectiveBpm(analysis(), { ...defaultEditState(), bpmOverride: 140 })).toMatchObject({ label: "140.00", overridden: true });
    // brief既定は "可変" だが、strings.ts に既存の grid.variable="可変テンポ" と表記を統一する
    // (Task1レビューの既知逸脱: ローカル文言よりstrings.tsの既存表記を優先)。
    expect(effectiveBpm(analysis({ tempoMode: "variable", bpm: null }), defaultEditState())).toMatchObject({
      label: STRINGS.grid.variable, value: null, fixed: false,
    });
  });

  it("parseBpm: 30..300 のみ許可", () => {
    expect(parseBpm("128.5")).toBeCloseTo(128.5, 9);
    expect(parseBpm("29")).toBeNull();
    expect(parseBpm("301")).toBeNull();
    expect(parseBpm("abc")).toBeNull();
    expect(parseBpm("")).toBeNull(); // 空はガード(標準指示: 空はガード)
  });

  it("formatOffsetMs: 符号付きms(負号はU+2212、strings.tsのgrid.minus10/minus1と統一)", () => {
    expect(formatOffsetMs(0.023)).toBe("+23ms");
    expect(formatOffsetMs(-0.01)).toBe("−10ms");
    expect(formatOffsetMs(0)).toBe("+0ms");
  });

  it("timeSigLabel / keyLabel", () => {
    expect(timeSigLabel(6)).toBe("6/8");
    expect(timeSigLabel(3)).toBe("3/4");
    expect(keyLabel(analysis())).toBe("E minor · 9A");
  });
});
