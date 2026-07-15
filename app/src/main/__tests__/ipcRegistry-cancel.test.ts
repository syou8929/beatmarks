import { describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS, type AnalyzedProject, type AnalyzeOutcome } from "../../shared/ipc.js";
import { registerHandlers, type MainDeps } from "../ipcRegistry.js";

function fakeIpcMain() {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  return {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn),
    invoke: async (ch: string, ...args: unknown[]) => {
      const fn = handlers.get(ch);
      if (!fn) throw new Error(`no handler: ${ch}`);
      return fn({}, ...args);
    },
  };
}

const PROJECT = { baseName: "t" } as unknown as AnalyzedProject;

function deps(over: Partial<MainDeps> = {}): MainDeps {
  return {
    probeMedia: vi.fn(async () => ({ durationSec: 3, tracks: [] })),
    analyzeMedia: vi.fn(async () => PROJECT),
    cancelAnalyze: vi.fn(async () => {}),
    readFileBytes: vi.fn(async () => new Uint8Array([1]).buffer),
    saveProject: vi.fn(async () => "/tmp/x.bmk"),
    openProject: vi.fn(async () => null),
    writeExports: vi.fn(async () => ({ written: [], failed: [] })),
    chooseExportDir: vi.fn(async () => null),
    ...over,
  };
}

const REQ = { filePath: "/a.wav", input: { mode: "mix", trackIndexes: [0], channelSplit: "mono" } } as const;

describe("analyzeMedia センチネル変換", () => {
  it("成功時は {cancelled:false, project}", async () => {
    const ipc = fakeIpcMain();
    registerHandlers(ipc as never, deps());
    const out = (await ipc.invoke(IPC_CHANNELS.analyzeMedia, REQ)) as AnalyzeOutcome;
    expect(out.cancelled).toBe(false);
    if (!out.cancelled) expect(out.project.baseName).toBe("t");
  });

  it("AnalyzeCancelledError(name一致)は {cancelled:true} に変換される", async () => {
    const ipc = fakeIpcMain();
    const err = Object.assign(new Error("解析がキャンセルされました"), { name: "AnalyzeCancelledError" });
    registerHandlers(ipc as never, deps({ analyzeMedia: vi.fn(async () => { throw err; }) }));
    const out = (await ipc.invoke(IPC_CHANNELS.analyzeMedia, REQ)) as AnalyzeOutcome;
    expect(out).toEqual({ cancelled: true });
  });

  it("その他のエラーはそのまま再送出される", async () => {
    const ipc = fakeIpcMain();
    registerHandlers(ipc as never, deps({ analyzeMedia: vi.fn(async () => { throw new Error("boom"); }) }));
    await expect(ipc.invoke(IPC_CHANNELS.analyzeMedia, REQ)).rejects.toThrow(/boom/);
  });
});
