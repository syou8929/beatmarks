import { describe, expect, it } from "vitest";

import type { Viewport } from "../editor/waveGeom.js";
import { overviewSecToX, overviewWindowRect, overviewXToSec } from "../editor/overviewGeom.js";

describe("overviewGeom", () => {
  it("overviewXToSec: 全幅を尺に線形マップ", () => {
    expect(overviewXToSec(0, 1000, 200)).toBeCloseTo(0, 6);
    expect(overviewXToSec(500, 1000, 200)).toBeCloseTo(100, 6);
    expect(overviewXToSec(1000, 1000, 200)).toBeCloseTo(200, 6);
  });
  it("overviewXToSec: 尺0では0", () => {
    expect(overviewXToSec(500, 1000, 0)).toBe(0);
  });
  it("overviewSecToX は逆変換", () => {
    expect(overviewSecToX(100, 1000, 200)).toBeCloseTo(500, 6);
  });
  it("overviewWindowRect: 表示窓の x/w", () => {
    // vp: scroll=50, 1000px が 20s(0.02s/px)を表示 → 窓 [50,70]s
    const vp: Viewport = { scrollSec: 50, samplesPerPx: 882, sampleRate: 44100, widthPx: 1000 };
    const r = overviewWindowRect(200, vp, 1000);
    expect(r.x).toBeCloseTo(250, 0);  // 50/200*1000
    expect(r.w).toBeCloseTo(100, 0);  // 20/200*1000
  });
  it("overviewWindowRect: 尺0でも壊れない", () => {
    const vp: Viewport = { scrollSec: 0, samplesPerPx: 882, sampleRate: 44100, widthPx: 1000 };
    expect(overviewWindowRect(0, vp, 1000)).toEqual({ x: 0, w: 0 });
  });
});
