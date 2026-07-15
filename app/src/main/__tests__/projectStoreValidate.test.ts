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

/** レビュー要件: 壊れた.bmkは常に「型付きError+メッセージ」で拒否され、
 *  TypeError(未ガードのプロパティアクセスに起因するクラッシュ)には決してならない
 *  ことを明示的に確認する。 */
function expectTypedError(fn: () => void, pattern: RegExp): void {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).not.toBeInstanceOf(TypeError);
  expect((caught as Error).message).toMatch(pattern);
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

  // レビュー指摘(Important): 要素レベル+相互参照チェックの深化。
  // 再現したTypeError: sectionEdits:[null] / analysis.sections,hits:[null] は
  // deriveMarkers.ts:49等で最初の描画時にクラッシュ、activeSourceId不一致は
  // App.tsx の sources.find(...)! でクラッシュしていた。
  describe("edits.sectionEdits の要素検証(レビュー再現)", () => {
    it("sectionEdits:[null] はTypeErrorでなく型付きErrorになる(レビュー再現)", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = { ...defaultEditState(), sectionEdits: [null] };
      expectTypedError(() => validateProjectFile(v), /sectionEdits\[0\]/);
    });
    it("op が列挙外を検出", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(), sectionEdits: [{ op: "bogus", index: 0 }],
      };
      expect(() => validateProjectFile(v)).toThrow(/sectionEdits\[0\]\.op/);
    });
    it("move: index が非整数だと検出", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(), sectionEdits: [{ op: "move", index: "x", startSec: 1 }],
      };
      expect(() => validateProjectFile(v)).toThrow(/sectionEdits\[0\]\.index/);
    });
    it("move: index が負だと検出", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(), sectionEdits: [{ op: "move", index: -1, startSec: 1 }],
      };
      expect(() => validateProjectFile(v)).toThrow(/sectionEdits\[0\]\.index/);
    });
    it("move: startSec 欠落を検出", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(), sectionEdits: [{ op: "move", index: 0 }],
      };
      expect(() => validateProjectFile(v)).toThrow(/sectionEdits\[0\]\.startSec/);
    });
    it("rename: label 欠落を検出", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(), sectionEdits: [{ op: "rename", index: 0 }],
      };
      expect(() => validateProjectFile(v)).toThrow(/sectionEdits\[0\]\.label/);
    });
    it("recolor: color 欠落を検出", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(), sectionEdits: [{ op: "recolor", index: 0 }],
      };
      expect(() => validateProjectFile(v)).toThrow(/sectionEdits\[0\]\.color/);
    });
    it("add: startSec 欠落を検出", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(), sectionEdits: [{ op: "add", label: "x", color: "#fff" }],
      };
      expect(() => validateProjectFile(v)).toThrow(/sectionEdits\[0\]\.startSec/);
    });
    it("delete: index のみの正常形は通る", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(), sectionEdits: [{ op: "delete", index: 0 }],
      };
      expect(() => validateProjectFile(v)).not.toThrow();
    });
    it("add: 正常形は通る(indexなし)", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(),
        sectionEdits: [{ op: "add", startSec: 1, label: "間奏", color: "#888888" }],
      };
      expect(() => validateProjectFile(v)).not.toThrow();
    });
  });

  describe("edits.customMarkers の要素検証", () => {
    it("customMarkers:[null] はTypeErrorでなく型付きErrorになる(レビュー再現同型)", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = { ...defaultEditState(), customMarkers: [null] };
      expectTypedError(() => validateProjectFile(v), /customMarkers\[0\]/);
    });
    it("id が文字列でないと検出", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(),
        customMarkers: [{ id: 1, timeSec: 1, label: "x", type: "custom", color: "#fff", source: "user", sourceId: "mix" }],
      };
      expect(() => validateProjectFile(v)).toThrow(/customMarkers\[0\]\.id/);
    });
    it("timeSec が有限数でないと検出", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(),
        customMarkers: [{ id: "m1", timeSec: "x", label: "x", type: "custom", color: "#fff", source: "user", sourceId: "mix" }],
      };
      expect(() => validateProjectFile(v)).toThrow(/customMarkers\[0\]\.timeSec/);
    });
    it("label が文字列でないと検出", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(),
        customMarkers: [{ id: "m1", timeSec: 1, label: 1, type: "custom", color: "#fff", source: "user", sourceId: "mix" }],
      };
      expect(() => validateProjectFile(v)).toThrow(/customMarkers\[0\]\.label/);
    });
    it("type が \"custom\" でないと検出", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(),
        customMarkers: [{ id: "m1", timeSec: 1, label: "x", type: "beat", color: "#fff", source: "user", sourceId: "mix" }],
      };
      expect(() => validateProjectFile(v)).toThrow(/customMarkers\[0\]\.type/);
    });
    it("正常形は通る", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = {
        ...defaultEditState(),
        customMarkers: [{ id: "m1", timeSec: 1, label: "x", type: "custom", color: "#fff", source: "user", sourceId: "mix" }],
      };
      expect(() => validateProjectFile(v)).not.toThrow();
    });
  });

  describe("edits.deletedMarkerIds の要素検証", () => {
    it("文字列以外の要素を検出", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = { ...defaultEditState(), deletedMarkerIds: [123] };
      expectTypedError(() => validateProjectFile(v), /deletedMarkerIds/);
    });
    it("正常形(文字列配列)は通る", () => {
      const v = valid();
      (v["sources"] as any)[0].edits = { ...defaultEditState(), deletedMarkerIds: ["beat-0", "sec-o1"] };
      expect(() => validateProjectFile(v)).not.toThrow();
    });
  });

  describe("activeSourceId の相互参照検証(レビュー再現)", () => {
    it("sources に存在しないIDはTypeErrorでなく型付きErrorになる(レビュー再現)", () => {
      const v = valid();
      v["activeSourceId"] = "DOES_NOT_EXIST";
      expectTypedError(() => validateProjectFile(v), /activeSourceId.*sources/);
    });
    it("sources に存在するIDは通る(対照確認)", () => {
      const v = valid();
      v["activeSourceId"] = "mix";
      expect(() => validateProjectFile(v)).not.toThrow();
    });
  });

  describe("analysis 配列要素の検証(parseEngineResult経由、レビュー再現)", () => {
    it("analysis.sections:[null] はTypeErrorでなく型付きErrorになる(レビュー再現)", () => {
      const v = valid();
      (v["sources"] as any)[0].analysis = { ...engine.analysis, sections: [null] };
      expectTypedError(() => validateProjectFile(v), /analysis/);
    });
    it("analysis.hits:[null] はTypeErrorでなく型付きErrorになる(レビュー再現)", () => {
      const v = valid();
      (v["sources"] as any)[0].analysis = { ...engine.analysis, hits: [null] };
      expectTypedError(() => validateProjectFile(v), /analysis/);
    });
    it("analysis.silences:[null] はTypeErrorでなく型付きErrorになる", () => {
      const v = valid();
      (v["sources"] as any)[0].analysis = { ...engine.analysis, silences: [null] };
      expectTypedError(() => validateProjectFile(v), /analysis/);
    });
  });
});
