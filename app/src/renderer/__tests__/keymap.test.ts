import { describe, expect, it } from "vitest";

import { keyToCommand, nudgeAction, seekTarget, undoTargetSourceId } from "../editor/keymap.js";
import type { GridBeat } from "../../shared/deriveGrid.js";
import type { Marker } from "../../shared/types.js";

function ev(over: Partial<Parameters<typeof keyToCommand>[0]> = {}) {
  return { key: " ", shiftKey: false, metaKey: false, ctrlKey: false, target: null, ...over };
}

describe("keyToCommand", () => {
  it("網羅表", () => {
    expect(keyToCommand(ev({ key: " " }))).toEqual({ kind: "playPause" });
    expect(keyToCommand(ev({ key: "m" }))).toEqual({ kind: "addMarker" });
    expect(keyToCommand(ev({ key: "ArrowLeft" }))).toEqual({ kind: "seek", unit: "beat", dir: -1 });
    expect(keyToCommand(ev({ key: "ArrowRight", shiftKey: true }))).toEqual({ kind: "seek", unit: "bar", dir: 1 });
    expect(keyToCommand(ev({ key: "," }))).toEqual({ kind: "nudge", dir: -1, coarse: false });
    expect(keyToCommand(ev({ key: ".", shiftKey: true }))).toEqual({ kind: "nudge", dir: 1, coarse: true });
    expect(keyToCommand(ev({ key: "1" }))).toEqual({ kind: "toggleLane", lane: "beatGrid" });
    expect(keyToCommand(ev({ key: "4" }))).toEqual({ kind: "toggleLane", lane: "silence" });
    expect(keyToCommand(ev({ key: "z", metaKey: true }))).toEqual({ kind: "undo" });
    expect(keyToCommand(ev({ key: "z", metaKey: true, shiftKey: true }))).toEqual({ kind: "redo" });
  });
  it("入力要素にフォーカス中は無効", () => {
    expect(keyToCommand(ev({ key: "m", target: { tagName: "INPUT" } as unknown as EventTarget }))).toBeNull();
  });
  it("修飾キー付きの未知の組み合わせはnull(例: ctrl+z以外のctrl+文字)", () => {
    expect(keyToCommand(ev({ key: "a", ctrlKey: true }))).toBeNull();
  });
  it("contentEditable要素でも無効", () => {
    expect(keyToCommand(ev({ key: "m", target: { tagName: "DIV", isContentEditable: true } as unknown as EventTarget }))).toBeNull();
  });
});

describe("seekTarget / nudgeAction / undoTargetSourceId", () => {
  const pts: GridBeat[] = [0, 0.5, 1.0, 1.5].map((t, i) => ({ timeSec: t, index: i, isBar: i % 2 === 0, barNumber: 1, free: false }));
  it("seekTarget: 次/前の格子点", () => {
    expect(seekTarget(pts, 0.6, 1)).toBe(1.0);
    expect(seekTarget(pts, 0.6, -1)).toBe(0.5);
    expect(seekTarget(pts, 2.0, 1)).toBeNull();
  });
  it("nudgeAction: custom→移動 / section→境界移動 / 無選択→gridOffset", () => {
    const cm: Marker = { id: "custom-1", sourceId: "mix", timeSec: 3, type: "custom", label: "x", color: "#fff", source: "user" };
    expect(nudgeAction({ dir: 1, coarse: false }, cm, 0, 5)).toEqual({ type: "CUSTOM_MARKER_UPDATED", id: "custom-1", patch: { timeSec: 3.001 } });
    const sm: Marker = { id: "sec-o2", sourceId: "mix", timeSec: 10, type: "section", label: "A", color: "#fff", source: "auto" };
    expect(nudgeAction({ dir: -1, coarse: true }, sm, 0, 5)).toEqual({ type: "SECTION_EDIT_ADDED", op: { op: "move", index: 2, startSec: 9.99 } });
    expect(nudgeAction({ dir: 1, coarse: false }, null, 0.02, 5)).toEqual({ type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.021 } });
  });
  it("undoTargetSourceId: スタック先頭の sourceId", () => {
    expect(undoTargetSourceId([{ sourceId: "ch-L" }], [], "undo")).toBe("ch-L");
    expect(undoTargetSourceId([], [], "undo")).toBeNull();
  });
});
