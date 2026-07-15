import { describe, expect, it } from "vitest";

import { clampBoundarySec, resolveBoundaryDrag, sectionIndexFromId } from "../editor/sectionGeom.js";
import type { Viewport } from "../editor/waveGeom.js";

describe("sectionIndexFromId", () => {
  it("sec-o{i} は元添字、sec-a{n} は null", () => {
    expect(sectionIndexFromId("sec-o3")).toBe(3);
    expect(sectionIndexFromId("sec-o0")).toBe(0);
    expect(sectionIndexFromId("sec-a0")).toBeNull();
    expect(sectionIndexFromId("bar-1")).toBeNull();
  });
});

describe("clampBoundarySec", () => {
  it("前後の隣接境界から minGap を空けてクランプ", () => {
    expect(clampBoundarySec(5, 2, 10, 0.5)).toBe(5);
    expect(clampBoundarySec(2.1, 2, 10, 0.5)).toBe(2.5); // 前境界+minGap
    expect(clampBoundarySec(9.9, 2, 10, 0.5)).toBe(9.5); // 次境界-minGap
  });
});

describe("resolveBoundaryDrag", () => {
  const vp: Viewport = { scrollSec: 0, samplesPerPx: 441, sampleRate: 44100, widthPx: 1000 }; // 0.01s/px
  it("px→sec→snap→clamp の合成", () => {
    const snap = (s: number) => Math.round(s * 2) / 2; // 0.5s刻み
    // px=630 → 6.3s → snap 6.5s → 前2/後10でクランプ内 → 6.5
    expect(resolveBoundaryDrag(630, vp, 2, 10, 0.5, snap)).toBeCloseTo(6.5, 6);
    // px=120 → 1.2s → snap 1.0s → 前2+0.5=2.5でクランプ → 2.5
    expect(resolveBoundaryDrag(120, vp, 2, 10, 0.5, snap)).toBeCloseTo(2.5, 6);
  });
});
