// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GridBar } from "../../components/GridBar.js";
import { defaultEditState } from "../../../shared/validate.js";
import { STRINGS } from "../../strings.js";
import type { AnalysisResult, EditState } from "../../../shared/types.js";

const analysis: AnalysisResult = {
  durationSec: 30, tempoMode: "fixed", bpm: 128, gridOffsetSec: 0, beats: [], downbeatPhase: 0,
  tempoMap: [], key: { global: { name: "E minor", camelot: "9A", confidence: 0.86 }, perSection: [] },
  sections: [], hits: [], silences: [],
  envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
};

function setup(over: Partial<EditState> = {}, extra: { canUndo?: boolean; canRedo?: boolean } = {}) {
  const dispatch = vi.fn();
  render(<GridBar analysis={analysis} edits={{ ...defaultEditState(), ...over }}
    playheadSec={12.5} canUndo={extra.canUndo ?? true} canRedo={extra.canRedo ?? false} dispatch={dispatch} />);
  return dispatch;
}

describe("GridBar", () => {
  it("BPM を確定すると EDIT_APPLIED {bpmOverride}、範囲外は無視", () => {
    const dispatch = setup();
    fireEvent.click(screen.getByLabelText("BPM"));
    fireEvent.change(screen.getByLabelText("BPM"), { target: { value: "140" } });
    fireEvent.keyDown(screen.getByLabelText("BPM"), { key: "Enter" });
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { bpmOverride: 140 } });
    dispatch.mockClear();
    fireEvent.click(screen.getByLabelText("BPM"));
    fireEvent.change(screen.getByLabelText("BPM"), { target: { value: "400" } });
    fireEvent.keyDown(screen.getByLabelText("BPM"), { key: "Enter" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("オフセット +1ms / 拍子6/8 / 1拍目→ / アンカー設定 が正しい払い出し", () => {
    const dispatch = setup({ gridOffsetDeltaSec: 0.02, downbeatShift: 0 });
    fireEvent.click(screen.getByText("+1ms"));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.021 } });
    fireEvent.change(screen.getByLabelText("拍子"), { target: { value: "6/8" } });
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { beatsPerBar: 6 } });
    fireEvent.click(screen.getByText("→"));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { downbeatShift: 1 } });
    fireEvent.click(screen.getByText("アンカー設定"));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { gridAnchor: { timeSec: 12.5, freeBefore: true } } });
  });

  it("オフセット −1ms / −10ms / +10ms も正しく nudge する(editor/snap.nudgeSec と一致)", () => {
    const dispatch = setup({ gridOffsetDeltaSec: 0.02 });
    fireEvent.click(screen.getByText(STRINGS.grid.minus1));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.019 } });
    dispatch.mockClear();
    fireEvent.click(screen.getByText(STRINGS.grid.minus10));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.01 } });
    dispatch.mockClear();
    fireEvent.click(screen.getByText(STRINGS.grid.plus10));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.03 } });
  });

  it("1拍目← は downbeatShift-1 を払い出し、gridAnchor未設定では解除ボタンがdisabled", () => {
    const dispatch = setup({ downbeatShift: 2 });
    expect((screen.getByText(STRINGS.grid.anchorClear) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText(STRINGS.grid.downbeatLeft));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { downbeatShift: 1 } });
  });

  it("gridAnchor設定済みでは解除ボタンが有効になりクリックで gridAnchor:undefined を払い出す", () => {
    const dispatch = setup({ gridAnchor: { timeSec: 3, freeBefore: true } });
    const clearBtn = screen.getByText(STRINGS.grid.anchorClear) as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(false);
    fireEvent.click(clearBtn);
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { gridAnchor: undefined } });
  });

  it("½ / ×2 ボタンは現在のBPM値を係数倍して払い出す", () => {
    const dispatch = setup();
    fireEvent.click(screen.getByText(STRINGS.grid.half));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { bpmOverride: 64 } });
    dispatch.mockClear();
    fireEvent.click(screen.getByText(STRINGS.grid.double));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { bpmOverride: 256 } });
  });

  it("×2 ボタンは係数倍の結果が300を超える場合300にクランプする(テキスト入力と同じ範囲、gridModel.clampBpm)", () => {
    const dispatch = setup({ bpmOverride: 200 });
    fireEvent.click(screen.getByText(STRINGS.grid.double));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { bpmOverride: 300 } });
  });

  it("½ ボタンは係数倍の結果が30未満の場合30にクランプする(テキスト入力と同じ範囲、gridModel.clampBpm)", () => {
    const dispatch = setup({ bpmOverride: 40 });
    fireEvent.click(screen.getByText(STRINGS.grid.half));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { bpmOverride: 30 } });
  });

  it("KEYチップに名称・Camelot・信頼度を表示する", () => {
    setup();
    expect(screen.getByText("E minor · 9A")).toBeTruthy();
    expect(screen.getByText(`(${STRINGS.grid.confidence} 0.86)`)).toBeTruthy();
  });

  it("Undo/Redo ボタン: canUndo=true で有効/UNDO、canRedo=false で無効", () => {
    const dispatch = setup();
    const redo = screen.getByLabelText(STRINGS.grid.redo) as HTMLButtonElement;
    expect(redo.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(STRINGS.grid.undo));
    expect(dispatch).toHaveBeenCalledWith({ type: "UNDO" });
  });

  it("canRedo=true で REDO ボタンが有効になりクリックで REDO を払い出す", () => {
    const dispatch = setup({}, { canRedo: true });
    const redo = screen.getByLabelText(STRINGS.grid.redo) as HTMLButtonElement;
    expect(redo.disabled).toBe(false);
    fireEvent.click(redo);
    expect(dispatch).toHaveBeenCalledWith({ type: "REDO" });
  });

  it("ツールバーにメトロノームヒントのツールチップを付与する(strings.tsの未使用文言を活用)", () => {
    setup();
    expect(screen.getByTitle(STRINGS.grid.metronomeHint)).toBeTruthy();
  });
});
