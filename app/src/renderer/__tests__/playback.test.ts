import { describe, expect, it } from "vitest";

import { clicksInWindow } from "../audio/playback.js";

const GRID = [
  { timeSec: 0.25, isBar: true },
  { timeSec: 0.75, isBar: false },
  { timeSec: 1.25, isBar: false },
  { timeSec: 1.75, isBar: false },
  { timeSec: 2.25, isBar: true },
];

describe("clicksInWindow", () => {
  it("[from, to)の拍だけを返す", () => {
    const c = clicksInWindow(GRID, 0.5, 1.8);
    expect(c.map((x) => x.timeSec)).toEqual([0.75, 1.25, 1.75]);
  });

  it("小節頭フラグが保たれる", () => {
    const c = clicksInWindow(GRID, 0, 3);
    expect(c.filter((x) => x.isBar).map((x) => x.timeSec)).toEqual([0.25, 2.25]);
  });

  it("境界: fromちょうどは含み、toちょうどは含まない", () => {
    expect(clicksInWindow(GRID, 0.25, 2.25).map((x) => x.timeSec))
      .toEqual([0.25, 0.75, 1.25, 1.75]);
  });

  it("空グリッド・逆転窓は空", () => {
    expect(clicksInWindow([], 0, 10)).toEqual([]);
    expect(clicksInWindow(GRID, 2, 1)).toEqual([]);
  });
});
