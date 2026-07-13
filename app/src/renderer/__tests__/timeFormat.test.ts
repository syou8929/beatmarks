import { describe, expect, it } from "vitest";

import { deriveGrid } from "../../shared/deriveGrid.js";
import { FPS_PRESETS } from "../../shared/timebase.js";
import type { AnalysisResult } from "../../shared/types.js";
import { formatTime, parseTime, type TimeCtx } from "../editor/timeFormat.js";
import { defaultEditState } from "../../shared/validate.js";

const FPS30 = FPS_PRESETS["30"]!;
const FPS2997 = FPS_PRESETS["29.97"]!;

function grid() {
  // BPM120, offset0 → 拍0.5s間隔、4/4。小節1=拍0(0s)、拍0.5=小節1拍2 …
  const a: AnalysisResult = {
    durationSec: 20, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0,
    beats: Array.from({ length: 40 }, (_, i) => i * 0.5), downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [], hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
  };
  return deriveGrid(a, defaultEditState());
}

const ctx30: TimeCtx = { fps: FPS30, grid: grid() };
const ctx2997: TimeCtx = { fps: FPS2997, grid: grid() };

describe("sec 単位", () => {
  it("M:SS.mmm 形式", () => {
    expect(formatTime(83.456, "sec", ctx30)).toBe("1:23.456");
    expect(formatTime(0, "sec", ctx30)).toBe("0:00.000");
    expect(formatTime(9.5, "sec", ctx30)).toBe("0:09.500");
  });
  it("parse は 'M:SS.mmm' も 'SS.mmm' も許容", () => {
    expect(parseTime("1:23.456", "sec", ctx30)).toBeCloseTo(83.456, 6);
    expect(parseTime("83.456", "sec", ctx30)).toBeCloseTo(83.456, 6);
    expect(parseTime("bad", "sec", ctx30)).toBeNull();
  });
});

describe("frame 単位", () => {
  it("整数フレーム(round)", () => {
    expect(formatTime(1, "frame", ctx30)).toBe("30");
    expect(formatTime(1.017, "frame", ctx30)).toBe("31"); // 30.51→round31
  });
  it("parse→frameToTime 往復", () => {
    expect(parseTime("30", "frame", ctx30)).toBeCloseTo(1, 6);
    expect(parseTime("x", "frame", ctx30)).toBeNull();
  });
});

describe("tc 単位", () => {
  it("30fps 往復", () => {
    const tc = formatTime(60, "tc", ctx30);
    expect(tc).toBe("00:01:00:00");
    expect(parseTime(tc, "tc", ctx30)).toBeCloseTo(60, 6);
  });
  it("29.97 ノンドロップ: format→parse がフレーム量子化値に一致", () => {
    const sec = 61.234;
    const tc = formatTime(sec, "tc", ctx2997);
    const back = parseTime(tc, "tc", ctx2997)!;
    // フレームに丸めた値と往復一致(±半フレーム内)
    expect(Math.abs(back - sec)).toBeLessThan(1001 / 30000);
    expect(parseTime(tc, "tc", ctx2997)).not.toBeNull();
  });
  it("不正TCはnull", () => {
    expect(parseTime("1:2:3", "tc", ctx30)).toBeNull();
  });
});

describe("barBeat 単位", () => {
  it("小節.拍 表示(0s=小節1拍1, 0.5s=小節1拍2, 2s=小節2拍1)", () => {
    expect(formatTime(0, "barBeat", ctx30)).toBe("1.1");
    expect(formatTime(0.5, "barBeat", ctx30)).toBe("1.2");
    expect(formatTime(2, "barBeat", ctx30)).toBe("2.1");
  });
  it("parse: '2.1' → 小節2拍1 の秒", () => {
    expect(parseTime("2.1", "barBeat", ctx30)).toBeCloseTo(2, 6);
    expect(parseTime("1.3", "barBeat", ctx30)).toBeCloseTo(1, 6);
  });
  it("範囲外の拍/小節は null", () => {
    expect(parseTime("99.1", "barBeat", ctx30)).toBeNull();
    expect(parseTime("1.9", "barBeat", ctx30)).toBeNull(); // 4/4 に拍9は無い
  });
  it("グリッド空なら format は '–'", () => {
    expect(formatTime(1, "barBeat", { fps: FPS30, grid: [] })).toBe("–");
  });
});
