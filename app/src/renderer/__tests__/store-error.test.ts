import { describe, expect, it } from "vitest";

import type { AnalyzedProject, InputConfig } from "../../shared/ipc.js";
import type { AnalysisResult } from "../../shared/types.js";
import { initialState, reducer } from "../state/store.js";

function analysis(): AnalysisResult {
  return {
    durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25,
    beats: Array.from({ length: 20 }, (_, i) => 0.25 + i * 0.5),
    downbeatPhase: 0, tempoMap: [{ timeSec: 0, bpm: 120 }],
    key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [{ startSec: 0, endSec: 10, label: "A", clusterId: 0, chorusCandidate: false }],
    hits: [], silences: [],
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

const INPUT: InputConfig = { mode: "mix", trackIndexes: [0], channelSplit: "mono" };
const editor = () => reducer(initialState(), { type: "PROJECT_READY", project: project(), input: INPUT });

describe("error フェーズ", () => {
  it("ANALYZE_FAILED で error フェーズ+メッセージ保持", () => {
    const s = reducer({ phase: "analyzing", progress: null }, { type: "ANALYZE_FAILED", message: "boom" });
    expect(s.phase).toBe("error");
    if (s.phase === "error") expect(s.errorMessage).toBe("boom");
  });

  it("error フェーズから RESET で drop に戻る", () => {
    const s = reducer({ phase: "error", errorMessage: "x" }, { type: "RESET" });
    expect(s.phase).toBe("drop");
  });

  it("editor 到達前(drop)でも ANALYZE_FAILED は error に遷移できる", () => {
    const s = reducer(initialState(), { type: "ANALYZE_FAILED", message: "y" });
    expect(s.phase).toBe("error");
  });
});

describe("マーカー選択(undo対象外)", () => {
  it("PROJECT_READY 直後は selectedMarkerId が null", () => {
    const s = editor();
    if (s.phase !== "editor") throw new Error();
    expect(s.selectedMarkerId).toBeNull();
  });

  it("MARKER_SELECTED で selectedMarkerId を設定/クリアできる", () => {
    let s = reducer(editor(), { type: "MARKER_SELECTED", markerId: "bar-2" });
    if (s.phase !== "editor") throw new Error();
    expect(s.selectedMarkerId).toBe("bar-2");
    s = reducer(s, { type: "MARKER_SELECTED", markerId: null });
    if (s.phase !== "editor") throw new Error();
    expect(s.selectedMarkerId).toBeNull();
  });

  it("MARKER_SELECTED は undo スタックを積まない", () => {
    const s = reducer(editor(), { type: "MARKER_SELECTED", markerId: "bar-2" });
    if (s.phase !== "editor") throw new Error();
    expect(s.undo).toHaveLength(0);
  });

  it("SOURCE_SWITCHED で選択がクリアされる", () => {
    let s = reducer(editor(), { type: "MARKER_SELECTED", markerId: "bar-2" });
    s = reducer(s, { type: "SOURCE_SWITCHED", sourceId: "ch-L" });
    if (s.phase !== "editor") throw new Error();
    expect(s.project.activeSourceId).toBe("ch-L");
    expect(s.selectedMarkerId).toBeNull();
  });
});
