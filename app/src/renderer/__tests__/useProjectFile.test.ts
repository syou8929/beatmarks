// @vitest-environment jsdom
/** レビュー指摘(Important): useProjectFile の save/saveAs はIPC呼び出しに
 *  try/catchが無く、main/index.ts の saveProject が保存ダイアログのキャンセル時に
 *  投げる Error("保存がキャンセルされました")(通常操作)がそのまま
 *  unhandled rejection になっていた。キャンセルは無音で無視し、それ以外の
 *  エラーは alert(String(err)) で表面化することを確認する。 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalyzedProject, InputConfig, MenuEvent } from "../../shared/ipc.js";
import type { AnalysisResult } from "../../shared/types.js";
import { useProjectFile } from "../hooks/useProjectFile.js";
import { initialState, reducer, type Action, type AppState } from "../state/store.js";

function analysis(): AnalysisResult {
  return {
    durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25, beats: [0.25], downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [], hits: [], silences: [], envelopes: { sampleRateHz: 100, total: [0.5], low: [], mid: [], high: [] },
  };
}
const INPUT: InputConfig = { mode: "mix", trackIndexes: [0], channelSplit: "mono" };
function proj(): AnalyzedProject {
  return {
    mediaPath: "/m/t.mp4", mediaHash: "h".repeat(64), baseName: "t", playbackWavPath: "/tmp/p.wav", durationSec: 10,
    sources: [{ source: { id: "mix", kind: "mix", label: "2mix" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/a.wav" }],
  };
}
function editorState(): AppState {
  return reducer(initialState(), { type: "PROJECT_READY", project: proj(), input: INPUT });
}

type MenuCb = (ev: MenuEvent) => void;

/** window.beatmarks(preloadブリッジ)の最小モック。save/saveAs と onMenu 購読の
 *  検証に必要な分のみ実装する。 */
function installIpc(saveProject: (state: unknown, toPath: string | null) => Promise<string>): MenuCb[] {
  const menuCbs: MenuCb[] = [];
  const api = {
    saveProject,
    onMenu: (cb: MenuCb) => { menuCbs.push(cb); return () => {}; },
  };
  (window as unknown as { beatmarks: unknown }).beatmarks = api;
  return menuCbs;
}

afterEach(() => {
  delete (window as unknown as { beatmarks?: unknown }).beatmarks;
  vi.restoreAllMocks();
});

describe("useProjectFile: 保存キャンセル/エラーの静穏化(レビュー再現)", () => {
  it("保存キャンセル(main の Error(\"保存がキャンセルされました\"))は無音で無視: alertもdispatchも呼ばれない", async () => {
    const saveProject = vi.fn().mockRejectedValue(new Error("保存がキャンセルされました"));
    const menuCbs = installIpc(saveProject);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const dispatch = vi.fn<(a: Action) => void>();

    renderHook(() => useProjectFile(editorState(), dispatch));
    menuCbs.forEach((cb) => cb({ action: "save" }));

    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1));
    // rejectのマイクロタスクがhook内のcatchまで流れるのを待つ(unhandled rejectionなら
    // ここでvitestがテストを失敗させる)。
    await new Promise((r) => setTimeout(r, 0));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("saveAsのキャンセルも無音で無視する", async () => {
    const saveProject = vi.fn().mockRejectedValue(new Error("保存がキャンセルされました"));
    const menuCbs = installIpc(saveProject);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const dispatch = vi.fn<(a: Action) => void>();

    renderHook(() => useProjectFile(editorState(), dispatch));
    menuCbs.forEach((cb) => cb({ action: "saveAs" }));

    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("キャンセル以外のエラーはalert(String(err))で表面化し、dispatchはされない", async () => {
    const saveProject = vi.fn().mockRejectedValue(new Error("disk full"));
    const menuCbs = installIpc(saveProject);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const dispatch = vi.fn<(a: Action) => void>();

    renderHook(() => useProjectFile(editorState(), dispatch));
    menuCbs.forEach((cb) => cb({ action: "save" }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));

    expect(alertSpy).toHaveBeenCalledWith(String(new Error("disk full")));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("保存成功時はSAVEDがdispatchされ、alertは呼ばれない(対照確認)", async () => {
    const saveProject = vi.fn().mockResolvedValue("/x.bmk");
    const menuCbs = installIpc(saveProject);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const dispatch = vi.fn<(a: Action) => void>();

    renderHook(() => useProjectFile(editorState(), dispatch));
    menuCbs.forEach((cb) => cb({ action: "save" }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "SAVED", path: "/x.bmk" }));
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
