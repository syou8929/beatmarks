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

/** null = ユーザーが保存先ダイアログをキャンセル。
 *  T12必須指示(台帳・レビューImportant #1「書き出しの静黙全滅チェーンを閉じる」): main側の
 *  writeExports 呼び出し自体が予期せず reject した場合(IPC異常等。ソース単位の失敗は
 *  main/exportWriter.ts 側で既に failed[] に吸収済みのはずだが、念のためここでも受け止める)、
 *  例外をそのまま上に投げず WriteExportsResult の形(failed[]にエラーを1件)に変換して返す。
 *  こうすると呼び出し側(ExportPanel)は常に同じ結果表示ロジック(failed[]描画+リトライ)で
 *  エラーを扱え、専用の分岐を増やさずに済む。 */
export async function runExportFlow(
  opts: ExportOpts, project: EditorProject, api: ExportApi,
): Promise<WriteExportsResult | null> {
  const destDir = await api.chooseExportDir();
  if (!destDir) return null;
  try {
    return await api.writeExports({
      ...opts, fps: project.fps, rounding: project.rounding, destDir,
      projectState: toProjectFileState(project),
    });
  } catch (e) {
    return { written: [], failed: [{ path: destDir, message: e instanceof Error ? e.message : String(e) }] };
  }
}
