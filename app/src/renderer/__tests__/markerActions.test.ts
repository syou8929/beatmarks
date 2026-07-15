import { describe, expect, it } from "vitest";

import type { AnalyzedProject, InputConfig } from "../../shared/ipc.js";
import type { AnalysisResult, Marker } from "../../shared/types.js";
import { initialState, reducer, type AppState } from "../state/store.js";

function analysis(): AnalysisResult {
  return {
    durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25,
    beats: [0.25, 0.75], downbeatPhase: 0, tempoMap: [{ timeSec: 0, bpm: 120 }],
    key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [{ startSec: 0, endSec: 10, label: "A", clusterId: 0, chorusCandidate: false }],
    hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: Array(1000).fill(0.5), low: [], mid: [], high: [] },
  };
}
function project(): AnalyzedProject {
  return {
    mediaPath: "/m/t.mp4", mediaHash: "h".repeat(64), baseName: "t", playbackWavPath: "/tmp/p.wav",
    durationSec: 10,
    sources: [{ source: { id: "mix", kind: "mix", label: "2mix" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/a.wav" }],
  };
}
const custom: Marker = { id: "custom-1", sourceId: "mix", timeSec: 3, type: "custom", label: "旧", color: "#ffd166", source: "user" };
const INPUT: InputConfig = { mode: "mix", trackIndexes: [0], channelSplit: "mono" };
function editor(): AppState {
  let s = reducer(initialState(), { type: "PROJECT_READY", project: project(), input: INPUT });
  return reducer(s, { type: "CUSTOM_MARKER_ADDED", marker: custom });
}
function edits(s: AppState) {
  if (s.phase !== "editor") throw new Error("not editor");
  return s.project.sources[0]!.edits;
}

describe("CUSTOM_MARKER_UPDATED / MARKER_RESTORED", () => {
  it("patch.label でラベル変更", () => {
    const s = reducer(editor(), { type: "CUSTOM_MARKER_UPDATED", id: "custom-1", patch: { label: "新" } });
    expect(edits(s).customMarkers[0]!.label).toBe("新");
  });
  it("patch.timeSec で時刻移動(nudge用)", () => {
    const s = reducer(editor(), { type: "CUSTOM_MARKER_UPDATED", id: "custom-1", patch: { timeSec: 3.01 } });
    expect(edits(s).customMarkers[0]!.timeSec).toBeCloseTo(3.01, 9);
  });
  it("MARKER_DELETED→MARKER_RESTORED でラウンドトリップし undo できる", () => {
    let s = reducer(editor(), { type: "MARKER_DELETED", id: "beat-0" });
    expect(edits(s).deletedMarkerIds).toContain("beat-0");
    s = reducer(s, { type: "MARKER_RESTORED", id: "beat-0" });
    expect(edits(s).deletedMarkerIds).not.toContain("beat-0");
    s = reducer(s, { type: "UNDO" }); // 復元を取り消し → 再び削除済み
    expect(edits(s).deletedMarkerIds).toContain("beat-0");
  });
});

// Task 1 レビューの追加指示(計画doc 2026-07-13-editor-export.md 204行目): selectedMarkerId が
// UNDO/REDO を素通りすることのピン留めテスト。store.ts の UNDO/REDO は `...state` 展開で
// selectedMarker を触らない実装だが、それを固定化する回帰テストが無かったため追加する。
// (T12でselectedMarkerIdはソース限定の複合キー selectedMarker:{sourceId,markerId} に改名。)
describe("selectedMarker は UNDO/REDO を素通りする(ピン留め)", () => {
  it("選択中に別の編集を UNDO/REDO しても selectedMarker は変化しない", () => {
    let s = reducer(editor(), { type: "MARKER_SELECTED", selection: { sourceId: "mix", markerId: "custom-1" } });
    s = reducer(s, { type: "CUSTOM_MARKER_UPDATED", id: "custom-1", patch: { label: "新" } });
    if (s.phase !== "editor") throw new Error("not editor");
    expect(s.selectedMarker).toEqual({ sourceId: "mix", markerId: "custom-1" });

    s = reducer(s, { type: "UNDO" });
    if (s.phase !== "editor") throw new Error("not editor");
    expect(s.selectedMarker).toEqual({ sourceId: "mix", markerId: "custom-1" }); // UNDO は selectedMarker に触れない
    expect(edits(s).customMarkers[0]!.label).toBe("旧"); // 編集自体は取り消されている(対照確認)

    s = reducer(s, { type: "REDO" });
    if (s.phase !== "editor") throw new Error("not editor");
    expect(s.selectedMarker).toEqual({ sourceId: "mix", markerId: "custom-1" }); // REDO も同様
    expect(edits(s).customMarkers[0]!.label).toBe("新");
  });
});
