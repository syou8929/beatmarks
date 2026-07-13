import { describe, expect, it } from "vitest";

import type { AnalyzedProject } from "../../shared/ipc.js";
import type { AnalysisResult } from "../../shared/types.js";
import { initialState, reducer, type AppState } from "../state/store.js";
import { selectGrid, selectMarkers } from "../state/selectors.js";

function analysis(): AnalysisResult {
  const beats = Array.from({ length: 20 }, (_, i) => 0.25 + i * 0.5);
  return {
    durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25,
    beats, downbeatPhase: 0, tempoMap: [{ timeSec: 0, bpm: 120 }],
    key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [
      { startSec: 0, endSec: 5, label: "A", clusterId: 0, chorusCandidate: false },
      { startSec: 5, endSec: 10, label: "B", clusterId: 1, chorusCandidate: true },
    ],
    hits: [{ timeSec: 1, band: "low", strength: 0.9 }],
    silences: [],
    envelopes: { sampleRateHz: 100, total: Array(1000).fill(0.5), low: [], mid: [], high: [] },
  };
}

function project(): AnalyzedProject {
  return {
    mediaPath: "/m/t.mp4", mediaHash: "h".repeat(64), baseName: "t",
    playbackWavPath: "/tmp/p.wav", durationSec: 10,
    sources: [
      { source: { id: "mix", kind: "mix", label: "2mix" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/a.wav" },
      { source: { id: "ch-L", kind: "channel", label: "L" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/l.wav" },
    ],
  };
}

function editorState(): AppState {
  return reducer(initialState(), { type: "PROJECT_READY", project: project() });
}

function activeEdits(s: AppState) {
  if (s.phase !== "editor") throw new Error("not editor");
  return s.project.sources.find((x) => x.source.id === s.project.activeSourceId)!.edits;
}

describe("画面遷移", () => {
  it("PROJECT_READYでeditorへ・既定fps30/先頭ソースactive", () => {
    const s = editorState();
    expect(s.phase).toBe("editor");
    if (s.phase !== "editor") return;
    expect(s.project.activeSourceId).toBe("mix");
    expect(s.project.fps).toEqual({ num: 30, den: 1 });
    expect(s.project.sources).toHaveLength(2);
  });
});

describe("編集とundo/redo", () => {
  it("EDIT_APPLIEDがactiveソースにだけ効き、UNDOで戻る", () => {
    let s = editorState();
    s = reducer(s, { type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.01 } });
    expect(activeEdits(s).gridOffsetDeltaSec).toBeCloseTo(0.01, 9);
    if (s.phase === "editor") {
      const other = s.project.sources.find((x) => x.source.id === "ch-L")!;
      expect(other.edits.gridOffsetDeltaSec).toBe(0);
    }
    s = reducer(s, { type: "UNDO" });
    expect(activeEdits(s).gridOffsetDeltaSec).toBe(0);
    s = reducer(s, { type: "REDO" });
    expect(activeEdits(s).gridOffsetDeltaSec).toBeCloseTo(0.01, 9);
  });

  it("SECTION_EDIT_ADDED/MARKER_DELETED/CUSTOM_MARKER_ADDEDもundo可能", () => {
    let s = editorState();
    s = reducer(s, { type: "SECTION_EDIT_ADDED", op: { op: "rename", index: 0, label: "イントロ" } });
    s = reducer(s, { type: "MARKER_DELETED", id: "bar-2" });
    s = reducer(s, {
      type: "CUSTOM_MARKER_ADDED",
      marker: { id: "custom-1", sourceId: "mix", timeSec: 3, type: "custom",
        label: "M", color: "#ffd166", source: "user" },
    });
    expect(activeEdits(s).sectionEdits).toHaveLength(1);
    expect(activeEdits(s).deletedMarkerIds).toContain("bar-2");
    expect(activeEdits(s).customMarkers).toHaveLength(1);
    s = reducer(s, { type: "UNDO" });
    expect(activeEdits(s).customMarkers).toHaveLength(0);
    s = reducer(s, { type: "UNDO" });
    expect(activeEdits(s).deletedMarkerIds).toHaveLength(0);
  });

  it("SOURCE_SWITCHEDはundo対象外でスタックを保つ", () => {
    let s = editorState();
    s = reducer(s, { type: "EDIT_APPLIED", edit: { downbeatShift: 1 } });
    s = reducer(s, { type: "SOURCE_SWITCHED", sourceId: "ch-L" });
    if (s.phase === "editor") expect(s.project.activeSourceId).toBe("ch-L");
    // UNDOはソース切替ではなく直前の編集(mix側)を戻す
    s = reducer(s, { type: "UNDO" });
    if (s.phase !== "editor") throw new Error();
    const mix = s.project.sources.find((x) => x.source.id === "mix")!;
    expect(mix.edits.downbeatShift).toBe(0);
  });
});

describe("deletedMarkerIdsクリア規則(計画②契約)", () => {
  it("グリッド編集でbeat-/bar-が消えsil-とsec-は残る", () => {
    let s = editorState();
    s = reducer(s, { type: "MARKER_DELETED", id: "bar-2" });
    s = reducer(s, { type: "MARKER_DELETED", id: "beat-3" });
    s = reducer(s, { type: "MARKER_DELETED", id: "sil-0-in" });
    s = reducer(s, { type: "MARKER_DELETED", id: "sec-o0" });
    s = reducer(s, { type: "EDIT_APPLIED", edit: { downbeatShift: 1 } });
    expect(activeEdits(s).deletedMarkerIds.sort()).toEqual(["sec-o0", "sil-0-in"]);
  });

  it("silenceThreshold変更でsil-だけ消える", () => {
    let s = editorState();
    s = reducer(s, { type: "MARKER_DELETED", id: "sil-0-in" });
    s = reducer(s, { type: "MARKER_DELETED", id: "bar-2" });
    s = reducer(s, { type: "EDIT_APPLIED", edit: { silenceThreshold: { db: -50, minDurSec: 0.7 } } });
    expect(activeEdits(s).deletedMarkerIds).toEqual(["bar-2"]);
  });
});

describe("selectors", () => {
  it("selectMarkersは同一入力で同一参照(メモ化)・編集で再計算", () => {
    let s = editorState();
    const m1 = selectMarkers(s);
    const m2 = selectMarkers(s);
    expect(m1).toBe(m2);
    expect(m1.length).toBeGreaterThan(0);
    s = reducer(s, { type: "EDIT_APPLIED", edit: { hitThreshold: { low: 0.95, mid: 0, high: 0 } } });
    const m3 = selectMarkers(s);
    expect(m3).not.toBe(m1);
    expect(m3.filter((m) => m.type === "hit")).toHaveLength(0);
    expect(selectGrid(s).length).toBe(20);
  });
});
