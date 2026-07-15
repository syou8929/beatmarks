import { describe, expect, it } from "vitest";

import type { AnalyzedProject, InputConfig, ProjectFileState } from "../../shared/ipc.js";
import type { AnalysisResult } from "../../shared/types.js";
import { defaultEditState } from "../../shared/validate.js";
import { initialState, reducer, type AppState } from "../state/store.js";

function analysis(): AnalysisResult {
  return {
    durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25, beats: [0.25], downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [], hits: [], silences: [], envelopes: { sampleRateHz: 100, total: Array(1000).fill(0.5), low: [], mid: [], high: [] },
  };
}
function proj(): AnalyzedProject {
  return { mediaPath: "/m/t.mp4", mediaHash: "h".repeat(64), baseName: "t", playbackWavPath: "/tmp/p.wav", durationSec: 10,
    sources: [{ source: { id: "mix", kind: "mix", label: "2mix" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/a.wav" }] };
}
// PROJECT_READY の input は AnalyzedProject に無い(main/analyzeMedia.ts はInputConfigを返さない) ため
// 台帳追加要件により store.ts の PROJECT_READY アクション自体に input を持たせている(App.tsx は
// startAnalyze() のローカル変数から渡す)。テストではここで固定値を渡す。
const INPUT: InputConfig = { mode: "mix", trackIndexes: [0], channelSplit: "mono" };

function dirty(s: AppState): boolean { if (s.phase !== "editor") throw new Error("x"); return s.isDirty; }

describe("dirty フラグ", () => {
  it("PROJECT_READY は clean、編集で dirty、SAVED で clean", () => {
    let s = reducer(initialState(), { type: "PROJECT_READY", project: proj(), input: INPUT });
    expect(dirty(s)).toBe(false);
    s = reducer(s, { type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.01 } });
    expect(dirty(s)).toBe(true);
    s = reducer(s, { type: "SAVED", path: "/x.bmk" });
    expect(dirty(s)).toBe(false);
    if (s.phase === "editor") expect(s.projectPath).toBe("/x.bmk");
  });
  it("MARKER_SELECTED は dirty を変えない", () => {
    let s = reducer(initialState(), { type: "PROJECT_READY", project: proj(), input: INPUT });
    s = reducer(s, { type: "MARKER_SELECTED", markerId: "beat-0" });
    expect(dirty(s)).toBe(false);
  });

  // 台帳追加要件(Task10レビュー): PROJECT_READY の input をプロジェクトに保持しないと
  // .bmk への永続化(toProjectFileState)が空/既定値になってしまう。
  it("PROJECT_READY は action.input をプロジェクトに保持する(台帳追加要件)", () => {
    const custom: InputConfig = { mode: "multitrack", trackIndexes: [1, 3], channelSplit: "stereo-split" };
    const s = reducer(initialState(), { type: "PROJECT_READY", project: proj(), input: custom });
    if (s.phase !== "editor") throw new Error("not editor");
    expect(s.project.input).toEqual(custom);
  });

  it("PROJECT_LOADED は .bmk の input をプロジェクトに反映する(台帳追加要件)", () => {
    const persistedInput: InputConfig = { mode: "multitrack", trackIndexes: [1, 2], channelSplit: "mono" };
    const loaded: ProjectFileState = {
      version: 1, mediaPath: "/m/t.mp4", mediaHash: "h".repeat(64), baseName: "t", durationSec: 10,
      input: persistedInput,
      sources: [{ source: { id: "mix", kind: "mix", label: "2mix" }, analysis: analysis(), edits: defaultEditState() }],
      activeSourceId: "mix", ui: { fps: { num: 30, den: 1 }, rounding: "nearest" },
    };
    const s = reducer(initialState(), {
      type: "PROJECT_LOADED", state: loaded, path: "/x.bmk", playbackWavPath: "/tmp/reopened.wav",
    });
    if (s.phase !== "editor") throw new Error("not editor");
    expect(s.project.input).toEqual(persistedInput);
    expect(s.project.playbackWavPath).toBe("/tmp/reopened.wav");
    expect(s.isDirty).toBe(false);
    expect(s.projectPath).toBe("/x.bmk");
  });
});
