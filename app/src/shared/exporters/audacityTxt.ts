/** Audacity ラベルトラック形式(タブ区切り: start / end / label)。 */
import type { ExportContext, Marker } from "../types.js";
import { selectMarkers } from "./helpers.js";

const sec = (n: number) => n.toFixed(6);

export function exportAudacityTxt(markers: Marker[], ctx: ExportContext): string {
  const rows: string[] = [];
  for (const m of selectMarkers(markers, ctx.include)) {
    const dur = m.meta?.durationSec ?? 0;
    const name = m.label.replace(/\t/g, " ").replace(/[\r\n]/g, " ");
    rows.push(`${sec(m.timeSec)}\t${sec(m.timeSec + dur)}\t${name}`);
  }
  return rows.join("\n") + "\n";
}
