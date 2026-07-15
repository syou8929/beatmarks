import { describe, expect, it } from "vitest";

import { canStereoSplit } from "../editor/inputConfig.js";

describe("canStereoSplit", () => {
  it("選択にステレオが1つでもあれば true", () => {
    expect(canStereoSplit([0, 1], [2, 1])).toBe(true);
    expect(canStereoSplit([1], [2, 1])).toBe(false);
    expect(canStereoSplit([], [2])).toBe(false);
  });
  it("選択添字がchannels範囲外(undefined)なら0扱いでfalse", () => {
    expect(canStereoSplit([5], [2, 1])).toBe(false);
  });
});
