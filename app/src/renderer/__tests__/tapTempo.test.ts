import { describe, expect, it } from "vitest";

import { tapsToBpm } from "../editor/tapTempo.js";

describe("tapsToBpm", () => {
  it("4タップ未満は null", () => {
    expect(tapsToBpm([])).toBeNull();
    expect(tapsToBpm([0, 500, 1000])).toBeNull();
  });
  it("500ms等間隔 → 120BPM", () => {
    expect(tapsToBpm([0, 500, 1000, 1500, 2000])!).toBeCloseTo(120, 3);
  });
  it("外れ値1つは中央値で吸収される", () => {
    // 500ms間隔に1回だけ大きな間(2000ms)が混ざっても中央値は500付近
    expect(tapsToBpm([0, 500, 1000, 3000, 3500, 4000])!).toBeCloseTo(120, 0);
  });
  it("順不同でもソートして処理", () => {
    expect(tapsToBpm([1500, 0, 1000, 500])!).toBeCloseTo(120, 3);
  });
});
