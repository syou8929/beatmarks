/** 汎用 CSV。列構成はスペック §8: time_sec, frame, timecode, type, label, color, strength, source */
import { formatSeconds, formatTimecode, timeToFrame } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";
import { csvField, selectMarkers } from "./helpers.js";

export function exportCsv(markers: Marker[], ctx: ExportContext): string {
  const rows = ["time_sec,frame,timecode,type,label,color,strength,source"];
  for (const m of selectMarkers(markers, ctx.include)) {
    const frame = timeToFrame(m.timeSec, ctx.fps, ctx.rounding);
    const strength =
      m.meta?.strength !== undefined ? String(Math.round(m.meta.strength * 100) / 100) : "";
    rows.push(
      [
        formatSeconds(m.timeSec),
        String(frame),
        formatTimecode(frame, ctx.fps),
        m.type,
        csvField(m.label),
        m.color,
        strength,
        m.source,
      ].join(","),
    );
  }
  return rows.join("\n") + "\n";
}
