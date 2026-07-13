/** ipcMain.handle の束ね役。実装は deps 注入(テスト・段階実装のため)。 */
import type { IpcMain } from "electron";

import { IPC_CHANNELS, type AnalyzedProject, type AnalyzeRequest, type ExportFilePayload, type ProbeResult, type ProjectFileState, type WriteExportsResult } from "../shared/ipc.js";

export interface MainDeps {
  probeMedia(filePath: string): Promise<ProbeResult>;
  analyzeMedia(req: AnalyzeRequest): Promise<AnalyzedProject>;
  cancelAnalyze(): Promise<void>;
  readFileBytes(path: string): Promise<ArrayBuffer>;
  saveProject(state: ProjectFileState, toPath: string | null): Promise<string>;
  openProject(): Promise<{ path: string; state: ProjectFileState } | null>;
  writeExports(files: ExportFilePayload[], dir: string | null): Promise<WriteExportsResult>;
}

export function registerHandlers(ipcMain: IpcMain, deps: MainDeps): void {
  ipcMain.handle(IPC_CHANNELS.probeMedia, (_e, filePath: string) => deps.probeMedia(filePath));
  ipcMain.handle(IPC_CHANNELS.analyzeMedia, (_e, req: AnalyzeRequest) => deps.analyzeMedia(req));
  ipcMain.handle(IPC_CHANNELS.cancelAnalyze, () => deps.cancelAnalyze());
  ipcMain.handle(IPC_CHANNELS.readFileBytes, (_e, path: string) => deps.readFileBytes(path));
  ipcMain.handle(IPC_CHANNELS.saveProject, (_e, state: ProjectFileState, toPath: string | null) =>
    deps.saveProject(state, toPath));
  ipcMain.handle(IPC_CHANNELS.openProject, () => deps.openProject());
  ipcMain.handle(IPC_CHANNELS.writeExports, (_e, files: ExportFilePayload[], dir: string | null) =>
    deps.writeExports(files, dir));
}
