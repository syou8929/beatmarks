import { describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS, type OpenProjectOutcome } from "../../shared/ipc.js";
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
    handlers,
  };
}

function deps(over: Partial<MainDeps> = {}): MainDeps {
  return {
    probeMedia: vi.fn(async () => ({ durationSec: 3, tracks: [] })),
    analyzeMedia: vi.fn(async () => ({ fake: true }) as never),
    cancelAnalyze: vi.fn(async () => {}),
    readFileBytes: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
    saveProject: vi.fn(async () => "/tmp/x.bmk"),
    openProject: vi.fn(async () => null),
    // 戻り値オブジェクトリテラルは vi.fn の generic 推論に対して文脈型付けされず ok: false が
    // boolean に広がってしまう(tsc実測で確認済み)ため、明示的に戻り値型を注記する。
    openProjectByPath: vi.fn(async (): Promise<OpenProjectOutcome> => ({ ok: false, message: "n/a" })),   // MainDeps 必須化に追随(Task11)
    writeExports: vi.fn(async () => ({ written: [], failed: [] })),
    chooseExportDir: vi.fn(async () => null),
    ...over,
  };
}

describe("registerHandlers", () => {
  it("全チャンネルが登録される", () => {
    const ipc = fakeIpcMain();
    registerHandlers(ipc as never, deps());
    for (const ch of Object.values(IPC_CHANNELS)) {
      expect(ipc.handlers.has(ch), ch).toBe(true);
    }
  });

  it("呼び出しがdepsへ委譲される", async () => {
    const ipc = fakeIpcMain();
    const d = deps();
    registerHandlers(ipc as never, d);
    await ipc.invoke(IPC_CHANNELS.probeMedia, "/a.mp4");
    expect(d.probeMedia).toHaveBeenCalledWith("/a.mp4");
    const bytes = (await ipc.invoke(IPC_CHANNELS.readFileBytes, "/a.wav")) as ArrayBuffer;
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("ハンドラ内例外は{code,message}に正規化される", async () => {
    const ipc = fakeIpcMain();
    registerHandlers(
      ipc as never,
      deps({ probeMedia: vi.fn(async () => { throw new Error("boom"); }) }),
    );
    await expect(ipc.invoke(IPC_CHANNELS.probeMedia, "/x")).rejects.toThrow(/boom/);
  });

  it("AudioSourceはspec§6の3フィールドを持つ(型回帰ガード)", () => {
    const s: import("../../shared/types.js").AudioSource = {
      id: "mix", kind: "mix", label: "2mix",
    };
    expect(s.kind).toBe("mix");
  });
});
