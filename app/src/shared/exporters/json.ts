/** 正規 JSON エクスポータ。全データ+秒/フレーム/タイムコード併記(スペック §8)。
 *  他ツール連携のリファレンス形式なのでキー順・形を安定させる。 */
import { formatTimecode, fpsLabel, timeToFrame } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";
import { selectMarkers } from "./helpers.js";

export const GENERATED_BY = "BeatMarks 0.1.0";

export function exportJson(markers: Marker[], ctx: ExportContext): string {
  const sel = selectMarkers(markers, ctx.include);
  const items = sel.map((m) => {
    const frame = timeToFrame(m.timeSec, ctx.fps, ctx.rounding);
    const item: Record<string, unknown> = {
      id: m.id,
      type: m.type,
      timeSec: m.timeSec,
      frame,
      timecode: formatTimecode(frame, ctx.fps),
      label: m.label,
      color: m.color,
      source: m.source,
    };
    if (m.meta?.durationSec !== undefined) {
      item["durationSec"] = m.meta.durationSec;
      item["frameOut"] = timeToFrame(m.timeSec + m.meta.durationSec, ctx.fps, ctx.rounding);
    }
    if (m.meta?.strength !== undefined) item["strength"] = m.meta.strength;
    if (m.meta?.band !== undefined) item["band"] = m.meta.band;
    if (m.meta?.barNumber !== undefined) item["barNumber"] = m.meta.barNumber;
    return item;
  });

  return JSON.stringify(
    {
      format: "beatmarks-markers",
      version: 1,
      generatedBy: GENERATED_BY,
      baseName: ctx.baseName,
      sourceLabel: ctx.sourceLabel,
      fps: { num: ctx.fps.num, den: ctx.fps.den, label: fpsLabel(ctx.fps) },
      rounding: ctx.rounding,
      durationSec: ctx.audioDurationSec,
      bpm: ctx.bpmLabel,
      key: ctx.keyLabel,
      tempoMap: ctx.tempoMap,
      envelopes: ctx.envelopes,
      markers: items,
    },
    null,
    2,
  );
}
