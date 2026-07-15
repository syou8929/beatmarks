// @vitest-environment jsdom
/** [回帰専用] EditorScreen ⇔ SectionBand 間のリネーム添字配線。
 *  EditorScreen.test.tsx は SectionBand をスタブ化しているため、EditorScreen 側の
 *  onRename ハンドラが実際に正しい添字で dispatch するかはそちらでは検出できない
 *  (SectionBand.test.tsx の回帰テストも SectionBand 単体止まりで、EditorScreen が
 *  受け取った index をどう解釈するかまでは検証できない)。本ファイルは SectionBand を
 *  実装のまま使い、EditorScreen.tsx の onRename ハンドラが SectionBand から渡された
 *  「元添字」をそのまま使う契約(onMoveBoundary と同じ)を守っていることを確認する。
 *  WaveCanvas/Overview/Transport は本テスト対象外の重量/canvas依存コンポーネントなので
 *  EditorScreen.test.tsx と同じ理由でスタブ化する(SectionBand とは異なり配線検証の対象ではない)。 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../components/WaveCanvas.js", () => ({ WaveCanvas: () => null }));
vi.mock("../components/Overview.js", () => ({ Overview: () => null }));
vi.mock("../components/Transport.js", () => ({ Transport: () => null }));
// SectionBand は意図的にモックしない — 本テストの主対象。

import { EditorScreen } from "../components/EditorScreen.js";
import { initialState, reducer, type AppState } from "../state/store.js";
import type { AnalyzedProject, InputConfig } from "../../shared/ipc.js";
import type { AnalysisResult } from "../../shared/types.js";
import type { PlaybackEngine } from "../audio/playback.js";

const INPUT: InputConfig = { mode: "mix", trackIndexes: [0], channelSplit: "mono" };

function analysis(): AnalysisResult {
  return {
    durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25, beats: [0.25, 0.75], downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    // 4セクション(元添字0-3)。o1 を後で削除し、表示位置と元添字をズラす(バグの再現条件)。
    sections: [
      { startSec: 0, endSec: 2.5, label: "Sec0", clusterId: 0, chorusCandidate: false },
      { startSec: 2.5, endSec: 5, label: "Sec1", clusterId: 1, chorusCandidate: false },
      { startSec: 5, endSec: 7.5, label: "Sec2", clusterId: 2, chorusCandidate: false },
      { startSec: 7.5, endSec: 10, label: "Sec3", clusterId: 3, chorusCandidate: false },
    ],
    hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: Array(1000).fill(0.5), low: [], mid: [], high: [] },
  };
}
function proj(): AnalyzedProject {
  return {
    mediaPath: "/m/t.mp4", mediaHash: "h".repeat(64), baseName: "t", playbackWavPath: "/tmp/p.wav", durationSec: 10,
    sources: [
      { source: { id: "mix", kind: "mix", label: "2mix" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/a.wav" },
    ],
  };
}
const fakePlayback = {
  isPlaying: () => false, play: vi.fn(), pause: vi.fn(), seek: vi.fn(), currentTime: () => 5, durationSec: () => 10,
} as unknown as PlaybackEngine;

function editorState(): Extract<AppState, { phase: "editor" }> {
  let s: AppState = reducer(initialState(), { type: "PROJECT_READY", project: proj(), input: INPUT });
  // 早い方のセクション(元添字1=sec-o1)を削除 → 表示配列(sectionViews)は
  // [sec-o0, sec-o2, sec-o3] になり、表示位置(0,1,2)と元添字(0,2,3)がズレる。
  s = reducer(s, { type: "MARKER_DELETED", id: "sec-o1" });
  if (s.phase !== "editor") throw new Error("x");
  return s;
}

describe("EditorScreen × SectionBand: セクションリネーム添字配線 [回帰]", () => {
  it("早い方のセクション削除後、後ろのセクションをリネームすると正しい元セクションに命中する(o2リネームがo3を誤爆しない)", () => {
    const dispatch = vi.fn();
    const { container } = render(<EditorScreen state={editorState()} dispatch={dispatch} playback={fakePlayback} />);
    const band = container.querySelector("[data-sectionband]") as HTMLElement;
    expect(band).toBeTruthy();

    // sec-o1 削除後の表示順: Sec0, Sec2, Sec3。表示2番目の Sec2 をダブルクリックしてリネーム。
    // (MarkerTable も同じラベル文字列を描画するため、SectionBand の帯だけに問い合わせを限定する。)
    fireEvent.doubleClick(within(band).getByText("Sec2"));
    const input = within(band).getByDisplayValue("Sec2");
    fireEvent.change(input, { target: { value: "Sec2改" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // 正: 元添字2(Sec2自身)で SECTION_EDIT_ADDED/rename が発行される。
    expect(dispatch).toHaveBeenCalledWith({
      type: "SECTION_EDIT_ADDED",
      op: { op: "rename", index: 2, label: "Sec2改" },
    });
    // バグの症状(表示位置を元添字として再解決し、隣のセクションを誤爆する)が
    // 起きていないことも明示的に否定する。
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "SECTION_EDIT_ADDED",
      op: { op: "rename", index: 3, label: "Sec2改" },
    });
  });
});
