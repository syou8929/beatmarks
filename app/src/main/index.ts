import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { IPC_EVENTS } from "../shared/ipc.js";
import { createAnalyzer } from "./analyzeMedia.js";
import { EngineClient } from "./engineClient.js";
import { probeMedia } from "./ffmpeg.js";
import { registerHandlers } from "./ipcRegistry.js";
import { cleanupTempDir, engineCommand, isPathWithinRoots, tempDir } from "./paths.js";
import { openProjectFrom, saveProjectTo, validateProjectFile } from "./projectStore.js";

let win: BrowserWindow | null = null;
/** readFileBytes を許可するパス集合(temp配下+開いたプロジェクトの参照wav) */
const readableRoots = new Set<string>();

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 980, title: "BeatMarks",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      nodeIntegration: false, contextIsolation: true, sandbox: false,
      // DAW的ツールのため非フォーカス時もメトロノーム/再生タイミングを維持する(バックグラウンドスロットリング無効化)
      backgroundThrottling: false,
    },
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  const engine = new EngineClient(engineCommand());
  const analyzer = createAnalyzer({
    engine,
    emitProgress: (ev) => win?.webContents.send(IPC_EVENTS.analyzeProgress, ev),
  });
  readableRoots.add(tempDir());

  registerHandlers(ipcMain, {
    probeMedia,
    analyzeMedia: async (req) => {
      const p = await analyzer.analyzeMedia(req);
      readableRoots.add(p.playbackWavPath);
      return p;
    },
    cancelAnalyze: () => analyzer.cancel(),
    readFileBytes: async (path) => {
      if (!isPathWithinRoots(path, readableRoots)) {
        throw new Error("このパスの読み取りは許可されていません");
      }
      const buf = await readFile(path);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    saveProject: async (state, toPath) => {
      validateProjectFile(state);
      let target = toPath;
      if (!target) {
        const r = await dialog.showSaveDialog({
          defaultPath: `${state.baseName}.bmk`,
          filters: [{ name: "BeatMarks Project", extensions: ["bmk"] }],
        });
        if (r.canceled || !r.filePath) throw new Error("保存がキャンセルされました");
        target = r.filePath;
      }
      return saveProjectTo(state, target);
    },
    openProject: async () => {
      const r = await dialog.showOpenDialog({
        filters: [{ name: "BeatMarks Project", extensions: ["bmk"] }],
        properties: ["openFile"],
      });
      const path = r.filePaths[0];
      if (r.canceled || !path) return null;
      const loaded = await openProjectFrom(path);
      readableRoots.add(loaded.state.playbackWavPath);
      return loaded;
    },
    writeExports: async () => ({ dir: null, written: [], failed: [] }), // 計画③bで実装
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  let quitting = false;
  app.on("will-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    void engine.dispose().finally(() => {
      cleanupTempDir();
      app.quit();
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
