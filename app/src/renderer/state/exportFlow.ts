/** 書き出しフロー: 保存先ダイアログ → writeExports IPC。UIから注入して使う。 */
import type { ExportRequest, WriteExportsResult } from "../../shared/ipc.js";
import type { MarkerType } from "../../shared/types.js";
import type { TargetKey } from "../../shared/naming.js";
import type { EditorProject } from "./store.js";
import { toProjectFileState } from "./projectFile.js";

export interface ExportOpts {
  targets: TargetKey[];
  sourceIds: string[];
  include: MarkerType[];
  includeEnvelopes: boolean;
}

export interface ExportApi {
  chooseExportDir(): Promise<string | null>;
  writeExports(req: ExportRequest): Promise<WriteExportsResult>;
}

/** null = ユーザーが保存先ダイアログをキャンセル。 */
export async function runExportFlow(
  opts: ExportOpts, project: EditorProject, api: ExportApi,
): Promise<WriteExportsResult | null> {
  const destDir = await api.chooseExportDir();
  if (!destDir) return null;
  return api.writeExports({
    ...opts, fps: project.fps, rounding: project.rounding, destDir,
    projectState: toProjectFileState(project),
  });
}
