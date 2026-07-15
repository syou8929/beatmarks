/** ipcMain.handle の束ね役。実装は deps 注入(テスト・段階実装のため)。 */
import type { IpcMain } from "electron";

import { IPC_CHANNELS, type AnalyzedProject, type AnalyzeOutcome, type AnalyzeRequest, type ExportRequest, type ProbeResult, type ProjectFileState, type WriteExportsResult } from "../shared/ipc.js";

export interface MainDeps {
  probeMedia(filePath: string): Promise<ProbeResult>;
  analyzeMedia(req: AnalyzeRequest): Promise<AnalyzedProject>;
  cancelAnalyze(): Promise<void>;
  readFileBytes(path: string): Promise<ArrayBuffer>;
  saveProject(state: ProjectFileState, toPath: string | null): Promise<string>;
  openProject(): Promise<{ path: string; state: ProjectFileState } | null>;
  writeExports(req: ExportRequest): Promise<WriteExportsResult>;
  chooseExportDir(): Promise<string | null>;
}

export function registerHandlers(ipcMain: IpcMain, deps: MainDeps): void {
  ipcMain.handle(IPC_CHANNELS.probeMedia, (_e, filePath: string) => deps.probeMedia(filePath));
  ipcMain.handle(
    IPC_CHANNELS.analyzeMedia,
    async (_e, req: AnalyzeRequest): Promise<AnalyzeOutcome> => {
      try {
        const project = await deps.analyzeMedia(req);
        return { cancelled: false, project };
      } catch (e) {
        // キャンセルは name で判定する(IPC 越えのエラー同一性に依存しない/
        // analyzeMedia.ts の重い import を避ける — AnalyzeCancelledError.name は Task1 で設定)。
        if (e instanceof Error && e.name === "AnalyzeCancelledError") {
          return { cancelled: true };
        }
        throw e;
      }
    },
  );
  ipcMain.handle(IPC_CHANNELS.cancelAnalyze, () => deps.cancelAnalyze());
  ipcMain.handle(IPC_CHANNELS.readFileBytes, (_e, path: string) => deps.readFileBytes(path));
  ipcMain.handle(IPC_CHANNELS.saveProject, (_e, state: ProjectFileState, toPath: string | null) =>
    deps.saveProject(state, toPath));
  ipcMain.handle(IPC_CHANNELS.openProject, () => deps.openProject());
  ipcMain.handle(IPC_CHANNELS.writeExports, (_e, req: ExportRequest) => deps.writeExports(req));
  ipcMain.handle(IPC_CHANNELS.chooseExportDir, () => deps.chooseExportDir());
}
