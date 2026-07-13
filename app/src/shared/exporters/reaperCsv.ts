/** REAPER 用タブ区切り CSV。X-Raym の「Import markers and regions from
 *  tab-delimited CSV file」で読み込む(インポート時に列を指定できるため、
 *  この安定した列構成を正とする。2026-07 調査)。 */
import type { ExportContext, Marker } from "../types.js";
import { selectMarkers } from "./helpers.js";

const sec = (n: number) => n.toFixed(6);

export function exportReaperCsv(markers: Marker[], ctx: ExportContext): string {
  const rows = ["Name\tStart\tEnd\tLength\tColor\tType"];
  for (const m of selectMarkers(markers, ctx.include)) {
    const dur = m.meta?.durationSec ?? 0;
    const name = m.label.replace(/\t/g, " ").replace(/[\r\n]/g, " ");
    rows.push(
      `${name}\t${sec(m.timeSec)}\t${sec(m.timeSec + dur)}\t${sec(dur)}\t${m.color}\t${m.type}`,
    );
  }
  return rows.join("\n") + "\n";
}
