import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import { IPC_EVENTS } from "../shared/ipc.js";
import { createAnalyzer } from "./analyzeMedia.js";
import { EngineClient } from "./engineClient.js";
import { writeExports } from "./exportWriter.js";
import { extractPlaybackWav, probeMedia } from "./ffmpeg.js";
import { registerHandlers } from "./ipcRegistry.js";
import { buildMenuTemplate } from "./menu.js";
import { openProjectFlow } from "./openProject.js";
import { cleanupTempDir, engineCommand, isPathWithinRoots, tempDir } from "./paths.js";
import { openProjectFrom, saveProjectTo, validateProjectFile } from "./projectStore.js";
import { addRecent, loadRecent } from "./recent.js";

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

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

app.whenReady().then(() => {
  const engine = new EngineClient(engineCommand());
  const analyzer = createAnalyzer({
    engine,
    emitProgress: (ev) => win?.webContents.send(IPC_EVENTS.analyzeProgress, ev),
  });
  readableRoots.add(tempDir());

  // .bmk 再オープン用 deps(main/openProject.ts の openProjectFlow に注入)。
  const openDeps = () => ({
    readProject: async (p: string) => (await openProjectFrom(p)).state,
    exists: existsSync,
    extractPlaybackWav,
    hashFile: sha256File,
    jobDir: () => {
      const d = join(tempDir(), `open-${Date.now()}`);
      mkdirSync(d, { recursive: true });
      return d;
    },
  });

  function refreshMenu(): void {
    const recent = loadRecent(app.getPath("userData"));
    const template = buildMenuTemplate({
      onOpen: () => win?.webContents.send(IPC_EVENTS.menu, { action: "open" }),
      onSave: () => win?.webContents.send(IPC_EVENTS.menu, { action: "save" }),
      onSaveAs: () => win?.webContents.send(IPC_EVENTS.menu, { action: "saveAs" }),
      onOpenRecent: (p) => win?.webContents.send(IPC_EVENTS.menu, { action: "openRecent", path: p }),
      onUndo: () => win?.webContents.send(IPC_EVENTS.menu, { action: "undo" }),
      onRedo: () => win?.webContents.send(IPC_EVENTS.menu, { action: "redo" }),
    }, recent);
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

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
      const saved = await saveProjectTo(state, target);
      addRecent(app.getPath("userData"), saved);
      refreshMenu();
      return saved;
    },
    openProject: async () => {
      const r = await dialog.showOpenDialog({
        filters: [{ name: "BeatMarks Project", extensions: ["bmk"] }],
        properties: ["openFile"],
      });
      const path = r.filePaths[0];
      if (r.canceled || !path) return null;
      const outcome = await openProjectFlow(path, openDeps());
      if (outcome.ok) {
        readableRoots.add(outcome.playbackWavPath);
        addRecent(app.getPath("userData"), path);
        refreshMenu();
      }
      return outcome;
    },
    openProjectByPath: async (path) => {
      const outcome = await openProjectFlow(path, openDeps());
      if (outcome.ok) {
        readableRoots.add(outcome.playbackWavPath);
        addRecent(app.getPath("userData"), path);
        refreshMenu();
      }
      return outcome;
    },
    writeExports: (req) =>
      writeExports(req, {
        readFile: async (p) => new Uint8Array(await readFile(p)),
        writeFile: (p, d) => writeFile(p, typeof d === "string" ? d : Buffer.from(d)),
        // 動画入力の cue 埋め込みは 44.1k stereo のフル抽出で代用する。trackIndexes は
        // ProjectFileState.input(Task11で .bmk に永続化)をそのまま使う — 以前はここが
        // [0] 固定で、再オープン後の書き出しがトラック選択を無視していた。
        extractWavForCues: (media, trackIndexes, dest) => extractPlaybackWav(media, trackIndexes, dest),
        tmpWavPath: () => join(tempDir(), `cues-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`),
      }),
    chooseExportDir: async () => {
      const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
  });

  createWindow();
  refreshMenu();
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
