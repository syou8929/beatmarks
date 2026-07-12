/** DaVinci Resolve のマーカー読み込み(Timeline Markers from EDL)互換の
 *  CMX3600 風 EDL(スペック §8)。1マーカー = イベント行+コメント行。改行は CRLF。 */
import { formatTimecode, timeToFrame } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";
import { padLeft, selectMarkers } from "./helpers.js";

/** BeatMarks パレット hex → Resolve マーカー色名 */
const COLOR_MAP: Record<string, string> = {
  "#5b7fd4": "Blue", "#38a3a5": "Cyan", "#f4a259": "Sand", "#e4547c": "Rose",
  "#8d78d9": "Purple", "#b56fd0": "Lavender", "#6b7686": "Sky", "#4f8f6b": "Mint",
  "#ff7847": "Red", "#ffd166": "Yellow", "#5ad1e6": "Cyan",
  "#8b94a3": "Sky", "#e8ebf0": "Cream",
};

export function exportResolveEdl(markers: Marker[], ctx: ExportContext): string {
  const sel = selectMarkers(markers, ctx.include);
  const lines: string[] = [`TITLE: ${ctx.baseName}_BeatMarks`, `FCM: NON-DROP FRAME`, ``];

  sel.forEach((m, i) => {
    const inF = timeToFrame(m.timeSec, ctx.fps, ctx.rounding);
    const durF = m.meta?.durationSec
      ? Math.max(1, timeToFrame(m.timeSec + m.meta.durationSec, ctx.fps, ctx.rounding) - inF)
      : 1;
    const inTC = formatTimecode(inF, ctx.fps);
    const outTC = formatTimecode(inF + durF, ctx.fps);
    const color = COLOR_MAP[m.color.toLowerCase()] ?? "Blue";
    lines.push(
      `${padLeft(i + 1, 3)}  001      V     C        ${inTC} ${outTC} ${inTC} ${outTC}`,
      ` |C:ResolveColor${color} |M:${m.label} |D:${durF}`,
      ``,
    );
  });

  return lines.join("\r\n");
}
