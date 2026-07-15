// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarkerTable } from "../../components/MarkerTable.js";
import { defaultEditState } from "../../../shared/validate.js";
import type { SourceState } from "../../state/store.js";
import type { AnalysisResult, Marker } from "../../../shared/types.js";
import { STRINGS } from "../../strings.js";

const custom: Marker = { id: "custom-1", sourceId: "mix", timeSec: 3, type: "custom", label: "フラッシュ", color: "#ffd166", source: "user" };
const analysis: AnalysisResult = {
  durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25, beats: [0.25], downbeatPhase: 0,
  tempoMap: [], key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
  sections: [{ startSec: 0, endSec: 10, label: "A", clusterId: 0, chorusCandidate: false }],
  hits: [], silences: [], envelopes: { sampleRateHz: 100, total: Array(1000).fill(0.5), low: [], mid: [], high: [] },
};
function src(over = {}): SourceState {
  return { source: { id: "mix", kind: "mix", label: "2mix" }, analysis, warnings: [], edits: { ...defaultEditState(), customMarkers: [custom], ...over } };
}
function setup(over = {}) {
  const dispatch = vi.fn(); const onSeek = vi.fn(); const onAddMarker = vi.fn();
  const s = src(over);
  render(<MarkerTable activeSource={s} sources={[s]} fps={{ num: 30, den: 1 }} rounding="nearest"
    selectedMarkerId={null} dispatch={dispatch} onSeek={onSeek} onAddMarker={onAddMarker} />);
  return { dispatch, onSeek };
}

describe("MarkerTable", () => {
  it("行クリックで MARKER_SELECTED + onSeek", () => {
    const { dispatch, onSeek } = setup();
    fireEvent.click(screen.getByText("フラッシュ"));
    expect(dispatch).toHaveBeenCalledWith({ type: "MARKER_SELECTED", markerId: "custom-1" });
    expect(onSeek).toHaveBeenCalledWith(3);
  });
  it("削除ボタンで MARKER_DELETED", () => {
    const { dispatch } = setup();
    fireEvent.click(screen.getByLabelText("削除 custom-1"));
    expect(dispatch).toHaveBeenCalledWith({ type: "MARKER_DELETED", id: "custom-1" });
  });
  it("手動マーカーのリネームで CUSTOM_MARKER_UPDATED{patch:{label}}", () => {
    const { dispatch } = setup();
    fireEvent.click(screen.getByLabelText("リネーム custom-1"));
    const input = screen.getByLabelText("ラベル編集 custom-1");
    fireEvent.change(input, { target: { value: "花火" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatch).toHaveBeenCalledWith({ type: "CUSTOM_MARKER_UPDATED", id: "custom-1", patch: { label: "花火" } });
  });
  it("削除済みトグルで復元行を表示し MARKER_RESTORED", () => {
    const { dispatch } = setup({ deletedMarkerIds: ["beat-0"] });
    fireEvent.click(screen.getByLabelText("削除済みを表示"));
    fireEvent.click(screen.getByLabelText("復元 beat-0"));
    expect(dispatch).toHaveBeenCalledWith({ type: "MARKER_RESTORED", id: "beat-0" });
  });

  // 以下はブリーフに無い追加分(実装検証の過程で見つけた不具合の回帰テスト)。

  it("[回帰] 編集中の入力欄クリックは行の選択/シークを発火しない(ラベルセルの伝播ガード)", () => {
    // ブリーフの元コードはラベルセルの onClick が常に stopPropagation していたため、
    // 「フラッシュ」テキストをクリックする1つ目のテスト自体が失敗する実装だった
    // (行クリック起因の MARKER_SELECTED/onSeek がラベルセルで止まってしまうため)。
    // 修正: stopPropagation は「編集中(input表示中)」の時だけに限定する。
    // このテストは「編集中は行選択を誘発しない」という意図した挙動を固定化する。
    const { dispatch, onSeek } = setup();
    fireEvent.click(screen.getByLabelText("リネーム custom-1"));
    const input = screen.getByLabelText("ラベル編集 custom-1");
    fireEvent.click(input);
    expect(dispatch).not.toHaveBeenCalledWith({ type: "MARKER_SELECTED", markerId: "custom-1" });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("[安全対策] ソース横断表示で他ソースの行は削除/リネームボタンを出さない(選択/シークは可能)", () => {
    // store の CUSTOM_MARKER_UPDATED/MARKER_DELETED/SECTION_EDIT_ADDED は常に
    // activeSourceId 側の edits にしか適用できない(state/store.ts の withActiveEdits)。
    // ソース横断表示で他ソースの行に削除/リネームを発行すると、id/添字が同じ意味で
    // 別ソースに存在しうるため(例: どのソースにも beat-0 がある)、アクティブソース側の
    // 無関係なマーカーを誤って書き換える実害バグになる。ここではその操作列を隠す。
    const other: Marker = { id: "custom-9", sourceId: "vo", timeSec: 5, type: "custom", label: "別ソースの印", color: "#ffd166", source: "user" };
    const mixSrc = src();
    const voSrc: SourceState = {
      source: { id: "vo", kind: "track", label: "Vo" }, analysis, warnings: [],
      edits: { ...defaultEditState(), customMarkers: [other] },
    };
    const dispatch = vi.fn();
    const onSeek = vi.fn();
    render(
      <MarkerTable activeSource={mixSrc} sources={[mixSrc, voSrc]} fps={{ num: 30, den: 1 }} rounding="nearest"
        selectedMarkerId={null} dispatch={dispatch} onSeek={onSeek} onAddMarker={vi.fn()} />,
    );
    fireEvent.click(screen.getByText(STRINGS.markerTable.crossSource));

    // アクティブソース(mix)自身の行は通常どおり操作可能
    expect(screen.getByLabelText("削除 custom-1")).toBeTruthy();
    // 他ソース(vo)の行は削除/リネームのボタンが存在しない
    expect(screen.queryByLabelText("削除 custom-9")).toBeNull();
    expect(screen.queryByLabelText("リネーム custom-9")).toBeNull();

    // ただし選択+シークは他ソースの行でも動く(閲覧・移動は安全なので塞がない)
    fireEvent.click(screen.getByText("別ソースの印"));
    expect(dispatch).toHaveBeenCalledWith({ type: "MARKER_SELECTED", markerId: "custom-9" });
    expect(onSeek).toHaveBeenCalledWith(5);
  });
});
