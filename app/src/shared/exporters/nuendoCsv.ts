/** Nuendo / Cubase のマーカー CSV 読み込み用。Start/End はタイムコード。
 *  Nuendo の CSV インポートは 24 / 25 / 29.97 / 30 fps 系のみ対応
 *  (2026-07 調査、Steinberg 公式ドキュメント)— それ以外は ExportError。 */
import { formatTimecode, timeToFrame } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";
import { csvField, ExportError, selectMarkers } from "./helpers.js";

const SUPPORTED = new Set(["24/1", "25/1", "30000/1001", "30/1"]);

export function exportNuendoCsv(markers: Marker[], ctx: ExportContext): string {
  if (!SUPPORTED.has(`${ctx.fps.num}/${ctx.fps.den}`)) {
    throw new ExportError(
      `Nuendo CSV は 24/25/29.97/30fps のみ対応です(指定: ${ctx.fps.num}/${ctx.fps.den})`,
    );
  }
  const rows = ["Name,Start,End,Length,Description"];
  for (const m of selectMarkers(markers, ctx.include)) {
    const inF = timeToFrame(m.timeSec, ctx.fps, ctx.rounding);
    const dur = m.meta?.durationSec ?? 0;
    const outF = dur > 0 ? timeToFrame(m.timeSec + dur, ctx.fps, ctx.rounding) : inF;
    rows.push([
      csvField(m.label),
      formatTimecode(inF, ctx.fps),
      formatTimecode(outF, ctx.fps),
      formatTimecode(outF - inF, ctx.fps),
      `BeatMarks:${m.type}`,
    ].join(","));
  }
  return rows.join("\n") + "\n";
}
