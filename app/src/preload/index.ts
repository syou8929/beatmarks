import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, IPC_EVENTS, type AnalyzeProgressEvent, type AnalyzeRequest, type ExportFilePayload, type IpcApi, type ProjectFileState } from "../shared/ipc.js";

const api: IpcApi & {
  onAnalyzeProgress(cb: (ev: AnalyzeProgressEvent) => void): () => void;
} = {
  probeMedia: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.probeMedia, filePath),
  analyzeMedia: (req: AnalyzeRequest) => ipcRenderer.invoke(IPC_CHANNELS.analyzeMedia, req),
  cancelAnalyze: () => ipcRenderer.invoke(IPC_CHANNELS.cancelAnalyze),
  readFileBytes: (path) => ipcRenderer.invoke(IPC_CHANNELS.readFileBytes, path),
  saveProject: (state: ProjectFileState, toPath) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveProject, state, toPath),
  openProject: () => ipcRenderer.invoke(IPC_CHANNELS.openProject),
  writeExports: (files: ExportFilePayload[], dir) =>
    ipcRenderer.invoke(IPC_CHANNELS.writeExports, files, dir),
  onAnalyzeProgress: (cb) => {
    const listener = (_e: unknown, ev: AnalyzeProgressEvent) => cb(ev);
    ipcRenderer.on(IPC_EVENTS.analyzeProgress, listener);
    return () => ipcRenderer.removeListener(IPC_EVENTS.analyzeProgress, listener);
  },
};

contextBridge.exposeInMainWorld("beatmarks", api);
