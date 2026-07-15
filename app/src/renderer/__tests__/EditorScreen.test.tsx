// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// T5/T6 の重量コンポーネントはスタブ(座標系/Canvasは本テスト対象外)。Transport/WaveCanvas は
// isPlaying の伝播を検証するため props を captured に記録する(vi.hoisted で mock factory から
// 参照できるようにする)。
const captured = vi.hoisted(() => ({
  transportProps: null as Record<string, unknown> | null,
  waveCanvasProps: null as Record<string, unknown> | null,
}));

vi.mock("../components/WaveCanvas.js", () => ({
  WaveCanvas: (props: Record<string, unknown>) => { captured.waveCanvasProps = props; return null; },
}));
vi.mock("../components/Overview.js", () => ({ Overview: () => null }));
vi.mock("../components/SectionBand.js", () => ({ SectionBand: () => null }));
vi.mock("../components/Transport.js", () => ({
  Transport: (props: Record<string, unknown>) => { captured.transportProps = props; return null; },
}));

import { EditorScreen } from "../components/EditorScreen.js";
import { initialState, reducer, type AppState } from "../state/store.js";
import type { AnalyzedProject, InputConfig } from "../../shared/ipc.js";
import type { AnalysisResult } from "../../shared/types.js";
import type { PlaybackEngine } from "../audio/playback.js";
import { STRINGS } from "../strings.js";

const INPUT: InputConfig = { mode: "mix", trackIndexes: [0], channelSplit: "mono" };

function analysis(): AnalysisResult {
  return {
    durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25, beats: [0.25, 0.75], downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [{ startSec: 0, endSec: 10, label: "A", clusterId: 0, chorusCandidate: false }],
    hits: [{ timeSec: 1, band: "low", strength: 0.9 }], silences: [],
    envelopes: { sampleRateHz: 100, total: Array(1000).fill(0.5), low: [], mid: [], high: [] },
  };
}
function proj(): AnalyzedProject {
  return {
    mediaPath: "/m/t.mp4", mediaHash: "h".repeat(64), baseName: "t", playbackWavPath: "/tmp/p.wav", durationSec: 10,
    sources: [
      { source: { id: "mix", kind: "mix", label: "2mix" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/a.wav" },
      { source: { id: "ch-L", kind: "channel", label: "L" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/l.wav" },
    ],
  };
}
const fakePlayback = {
  isPlaying: () => false, play: vi.fn(), pause: vi.fn(), seek: vi.fn(), currentTime: () => 5, durationSec: () => 10,
} as unknown as PlaybackEngine;

/** Space等の再生系テスト用に、play()/pause()で内部状態が実際に切り替わる素朴なスタブ。 */
function statefulPlayback(startSec: number): PlaybackEngine {
  let playing = false;
  let cur = startSec;
  return {
    isPlaying: () => playing,
    play: vi.fn(() => { playing = true; }),
    pause: vi.fn(() => { playing = false; }),
    seek: vi.fn((s: number) => { cur = s; }),
    currentTime: () => cur,
    durationSec: () => 10,
  } as unknown as PlaybackEngine;
}

function editorState(): Extract<AppState, { phase: "editor" }> {
  const s = reducer(initialState(), { type: "PROJECT_READY", project: proj(), input: INPUT });
  if (s.phase !== "editor") throw new Error("x");
  return s;
}

describe("EditorScreen", () => {
  it("スモーク: マーカーテーブルと書き出しパネルを描画", () => {
    render(<EditorScreen state={editorState()} dispatch={vi.fn()} playback={fakePlayback} />);
    expect(screen.getByText("マーカー一覧")).toBeTruthy();
    expect(screen.getByText("書き出し")).toBeTruthy();
  });

  it("playback が null のときはローディング表示にフォールバックする(hooks順序は不変)", () => {
    render(<EditorScreen state={editorState()} dispatch={vi.fn()} playback={null} />);
    expect(screen.getByText(STRINGS.editor.loadingPlayback)).toBeTruthy();
  });

  it("M キーで CUSTOM_MARKER_ADDED(playhead位置)", () => {
    const dispatch = vi.fn();
    render(<EditorScreen state={editorState()} dispatch={dispatch} playback={fakePlayback} />);
    fireEvent.keyDown(window, { key: "m" });
    const call = dispatch.mock.calls.find((c) => c[0].type === "CUSTOM_MARKER_ADDED");
    expect(call).toBeTruthy();
    expect(call![0].marker.timeSec).toBe(5);
    expect(call![0].marker.type).toBe("custom");
  });

  it("[回帰] テキスト入力にフォーカス中は M キーが無効(keyToCommandのガードがEditorScreen経由でも効く)", () => {
    const dispatch = vi.fn();
    render(<EditorScreen state={editorState()} dispatch={dispatch} playback={fakePlayback} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "m" });
    expect(dispatch.mock.calls.find((c) => c[0].type === "CUSTOM_MARKER_ADDED")).toBeUndefined();
    document.body.removeChild(input);
  });

  it("Space キーで isPlaying に応じて playback.play()/pause() を呼ぶ", () => {
    const pb = statefulPlayback(5);
    render(<EditorScreen state={editorState()} dispatch={vi.fn()} playback={pb} />);
    fireEvent.keyDown(window, { key: " " });
    expect(pb.play).toHaveBeenCalledTimes(1);
    expect(pb.pause).not.toHaveBeenCalled();
  });

  it("← → キーで拍シーク、Shift+← で小節シーク", () => {
    const pb = statefulPlayback(0.4); // beats=[0.25,0.75]の間
    render(<EditorScreen state={editorState()} dispatch={vi.fn()} playback={pb} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(pb.seek).toHaveBeenLastCalledWith(0.75);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(pb.seek).toHaveBeenLastCalledWith(0.25);
    // bar(小節)は既定編集では先頭拍(0.25)のみがbarになる(beatsPerBar=4, downbeatPhase=0)。
    // 0.4から後方にShift+ArrowLeftすると唯一のbarである0.25へ着地する。
    fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true });
    expect(pb.seek).toHaveBeenLastCalledWith(0.25);
  });

  it(", キーで選択なし→グリッドオフセットのnudge(EDIT_APPLIED)", () => {
    const dispatch = vi.fn();
    render(<EditorScreen state={editorState()} dispatch={dispatch} playback={fakePlayback} />);
    fireEvent.keyDown(window, { key: "," });
    const call = dispatch.mock.calls.find((c) => c[0].type === "EDIT_APPLIED" && "gridOffsetDeltaSec" in c[0].edit);
    expect(call).toBeTruthy();
    expect(call![0].edit.gridOffsetDeltaSec).toBeCloseTo(-0.001, 6);
  });

  it("3 キーで hits レーン(HitLanes)の表示をトグルする", () => {
    render(<EditorScreen state={editorState()} dispatch={vi.fn()} playback={fakePlayback} />);
    expect(screen.getByText(STRINGS.hitLane.tag)).toBeTruthy(); // 既定でON
    fireEvent.keyDown(window, { key: "3" });
    expect(screen.queryByText(STRINGS.hitLane.tag)).toBeNull();
    fireEvent.keyDown(window, { key: "3" });
    expect(screen.getByText(STRINGS.hitLane.tag)).toBeTruthy();
  });

  it("isPlaying が Transport と WaveCanvas 両方へ伝播する(単一の情報源・T5レビュー契約)", async () => {
    const pb = statefulPlayback(5);
    render(<EditorScreen state={editorState()} dispatch={vi.fn()} playback={pb} />);
    expect(captured.transportProps?.isPlaying).toBe(false);
    expect(captured.waveCanvasProps?.isPlaying).toBe(false);
    fireEvent.keyDown(window, { key: " " }); // Space起因でplayback.play()が呼ばれる
    await waitFor(() => expect(captured.transportProps?.isPlaying).toBe(true));
    expect(captured.waveCanvasProps?.isPlaying).toBe(true);
  });

  it("非アクティブソースの Undo でタブ自動切替+トースト", () => {
    // undo 先頭を ch-L に、active を mix にした状態を人工的に作る
    let s: AppState = editorState();
    s = reducer(s, { type: "SOURCE_SWITCHED", sourceId: "ch-L" });
    s = reducer(s, { type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.01 } }); // undo entry sourceId=ch-L
    s = reducer(s, { type: "SOURCE_SWITCHED", sourceId: "mix" });
    if (s.phase !== "editor") throw new Error("x");
    const dispatch = vi.fn();
    render(<EditorScreen state={s} dispatch={dispatch} playback={fakePlayback} />);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(dispatch).toHaveBeenCalledWith({ type: "SOURCE_SWITCHED", sourceId: "ch-L" });
    expect(dispatch).toHaveBeenCalledWith({ type: "UNDO" });
    expect(screen.getByRole("status").textContent).toContain("別ソース");
  });

  it("非アクティブソースの Redo でもタブ自動切替+トースト(undoの対称)", () => {
    let s: AppState = editorState();
    s = reducer(s, { type: "SOURCE_SWITCHED", sourceId: "ch-L" });
    s = reducer(s, { type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.01 } });
    s = reducer(s, { type: "UNDO" }); // redo entry(sourceId=ch-L)が積まれる
    s = reducer(s, { type: "SOURCE_SWITCHED", sourceId: "mix" });
    if (s.phase !== "editor") throw new Error("x");
    const dispatch = vi.fn();
    render(<EditorScreen state={s} dispatch={dispatch} playback={fakePlayback} />);
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(dispatch).toHaveBeenCalledWith({ type: "SOURCE_SWITCHED", sourceId: "ch-L" });
    expect(dispatch).toHaveBeenCalledWith({ type: "REDO" });
    expect(screen.getByRole("status").textContent).toContain("別ソース");
  });

  it("[回帰] GridBarのUndoボタンクリックでも(キーボードと同じく)別ソース切替+トーストが起きる(guardedDispatchの一貫性)", () => {
    let s: AppState = editorState();
    s = reducer(s, { type: "SOURCE_SWITCHED", sourceId: "ch-L" });
    s = reducer(s, { type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.01 } });
    s = reducer(s, { type: "SOURCE_SWITCHED", sourceId: "mix" });
    if (s.phase !== "editor") throw new Error("x");
    const dispatch = vi.fn();
    render(<EditorScreen state={s} dispatch={dispatch} playback={fakePlayback} />);
    fireEvent.click(screen.getByLabelText(STRINGS.grid.undo));
    expect(dispatch).toHaveBeenCalledWith({ type: "SOURCE_SWITCHED", sourceId: "ch-L" });
    expect(dispatch).toHaveBeenCalledWith({ type: "UNDO" });
    expect(screen.getByRole("status").textContent).toContain("別ソース");
  });
});
