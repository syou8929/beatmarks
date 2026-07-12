/** ターゲット→エクスポータのレジストリ。UI(計画③)はここだけを呼ぶ。 */
import { buildFileName, type TargetKey } from "../naming.js";
import type { ExportContext, Marker } from "../types.js";
import { exportAudacityTxt } from "./audacityTxt.js";
import { exportAeJsx } from "./aejsx.js";
import { exportBlenderPy } from "./blenderPy.js";
import { exportCsv } from "./csv.js";
import { ExportError } from "./helpers.js";
import { exportJson } from "./json.js";
import { exportMidi } from "./midi.js";
import { exportNuendoCsv } from "./nuendoCsv.js";
import { exportPremiereXml } from "./premiereXml.js";
import { exportReaperCsv } from "./reaperCsv.js";
import { exportResolveEdl } from "./resolveEdl.js";

export type TextTargetKey = Exclude<TargetKey, "midi" | "wavcues">;

export const TEXT_EXPORTERS: Record<
  TextTargetKey, (m: Marker[], ctx: ExportContext) => string
> = {
  json: exportJson,
  csv: exportCsv,
  aejsx: exportAeJsx,
  premiere: exportPremiereXml,
  resolve: exportResolveEdl,
  blender: exportBlenderPy,
  reaper: exportReaperCsv,
  nuendo: exportNuendoCsv,
  audacity: exportAudacityTxt,
};

export function runExport(
  target: TargetKey, markers: Marker[], ctx: ExportContext,
): { fileName: string; data: string | Uint8Array } {
  const fileName = buildFileName(ctx.baseName, ctx.sourceLabel, target);
  if (target === "wavcues") {
    throw new ExportError("wavcues は embedWavCues(wavBytes, markers, ctx) を直接使う");
  }
  if (target === "midi") {
    return { fileName, data: exportMidi(markers, ctx) };
  }
  return { fileName, data: TEXT_EXPORTERS[target](markers, ctx) };
}
