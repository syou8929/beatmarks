import { contextBridge, ipcRenderer, webUtils } from "electron";

import { IPC_CHANNELS, IPC_EVENTS, type AnalyzeProgressEvent, type AnalyzeRequest, type ExportRequest, type IpcApi, type MenuEvent, type ProjectFileState } from "../shared/ipc.js";

const api: IpcApi & {
  onAnalyzeProgress(cb: (ev: AnalyzeProgressEvent) => void): () => void;
  onMenu(cb: (ev: MenuEvent) => void): () => void;
} = {
  probeMedia: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.probeMedia, filePath),
  analyzeMedia: (req: AnalyzeRequest) => ipcRenderer.invoke(IPC_CHANNELS.analyzeMedia, req),
  cancelAnalyze: () => ipcRenderer.invoke(IPC_CHANNELS.cancelAnalyze),
  readFileBytes: (path) => ipcRenderer.invoke(IPC_CHANNELS.readFileBytes, path),
  saveProject: (state: ProjectFileState, toPath) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveProject, state, toPath),
  openProject: () => ipcRenderer.invoke(IPC_CHANNELS.openProject),
  openProjectByPath: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.openProjectByPath, path),
  writeExports: (req: ExportRequest) => ipcRenderer.invoke(IPC_CHANNELS.writeExports, req),
  chooseExportDir: () => ipcRenderer.invoke(IPC_CHANNELS.chooseExportDir),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onAnalyzeProgress: (cb) => {
    const listener = (_e: unknown, ev: AnalyzeProgressEvent) => cb(ev);
    ipcRenderer.on(IPC_EVENTS.analyzeProgress, listener);
    return () => ipcRenderer.removeListener(IPC_EVENTS.analyzeProgress, listener);
  },
  onMenu: (cb) => {
    const listener = (_e: unknown, ev: MenuEvent) => cb(ev);
    ipcRenderer.on(IPC_EVENTS.menu, listener);
    return () => ipcRenderer.removeListener(IPC_EVENTS.menu, listener);
  },
};

contextBridge.exposeInMainWorld("beatmarks", api);
