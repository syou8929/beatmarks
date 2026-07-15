import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { validateProjectFile } from "../projectStore.js";
import { defaultEditState, parseEngineResult } from "../../shared/validate.js";

const engine = parseEngineResult(
  readFileSync(join(__dirname, "..", "..", "shared", "__fixtures__", "analysis-30s.json"), "utf-8"),
);
function valid(): Record<string, unknown> {
  return {
    version: 1, mediaPath: "/m/t.mp4", mediaHash: "a".repeat(64), baseName: "t", durationSec: 30,
    input: { mode: "mix", trackIndexes: [0], channelSplit: "mono" },
    sources: [{ source: { id: "mix", kind: "mix", label: "2mix" }, analysis: engine.analysis, edits: defaultEditState() }],
    activeSourceId: "mix", ui: { fps: { num: 30, den: 1 }, rounding: "nearest" },
  };
}

describe("validateProjectFile 深化", () => {
  it("正常形は通る(playbackWavPath 不要)", () => {
    expect(() => validateProjectFile(valid())).not.toThrow();
  });
  it("edits.hitThreshold 欠落を検出", () => {
    const v = valid();
    (v["sources"] as any)[0].edits = { ...defaultEditState(), hitThreshold: undefined };
    expect(() => validateProjectFile(v)).toThrow(/hitThreshold/);
  });
  it("analysis 部分木の不正(durationSec 欠落)を parseEngineResult 経由で検出", () => {
    const v = valid();
    (v["sources"] as any)[0].analysis = { ...engine.analysis, durationSec: "x" };
    expect(() => validateProjectFile(v)).toThrow(/analysis/);
  });
  it("source.kind 不正を検出", () => {
    const v = valid();
    (v["sources"] as any)[0].source.kind = "bogus";
    expect(() => validateProjectFile(v)).toThrow(/source/);
  });
  it("ui.fps 非整数/0 を検出", () => {
    const v = valid();
    (v["ui"] as any).fps = { num: 0, den: 1 };
    expect(() => validateProjectFile(v)).toThrow(/fps/);
  });
  it("ui.rounding 列挙外を検出", () => {
    const v = valid();
    (v["ui"] as any).rounding = "round";
    expect(() => validateProjectFile(v)).toThrow(/rounding/);
  });

  // 台帳追加(Task11 追加要件): InputConfig を .bmk に永続化するため深い検証も必要。
  describe("input(InputConfig)の深化検証(台帳追加要件)", () => {
    it("input.mode 列挙外を検出", () => {
      const v = valid();
      (v["input"] as any).mode = "bogus";
      expect(() => validateProjectFile(v)).toThrow(/input/);
    });
    it("input.trackIndexes が非整数を含むと検出", () => {
      const v = valid();
      (v["input"] as any).trackIndexes = [0, "x"];
      expect(() => validateProjectFile(v)).toThrow(/input/);
    });
    it("input.trackIndexes が空配列だと検出", () => {
      const v = valid();
      (v["input"] as any).trackIndexes = [];
      expect(() => validateProjectFile(v)).toThrow(/input/);
    });
    it("input.channelSplit 列挙外を検出", () => {
      const v = valid();
      (v["input"] as any).channelSplit = "bogus";
      expect(() => validateProjectFile(v)).toThrow(/input/);
    });
    it("input 自体の欠落を検出", () => {
      const v = valid();
      delete v["input"];
      expect(() => validateProjectFile(v)).toThrow(/input/);
    });
  });
});
