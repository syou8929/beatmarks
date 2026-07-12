/** Premiere Pro 向け FCP XML (xmeml v4)。マーカー付きの空シーケンスを生成し、
 *  Premiere の「ファイル > 読み込み」でシーケンスマーカーとして取り込める(スペック §8)。 */
import { timeToFrame } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";
import { escapeXml, selectMarkers } from "./helpers.js";

function rateXml(ctx: ExportContext, indent: string): string {
  const timebase = Math.ceil(ctx.fps.num / ctx.fps.den);
  const ntsc = ctx.fps.den === 1001 ? "TRUE" : "FALSE";
  return [
    `${indent}<rate>`,
    `${indent}  <timebase>${timebase}</timebase>`,
    `${indent}  <ntsc>${ntsc}</ntsc>`,
    `${indent}</rate>`,
  ].join("\n");
}

export function exportPremiereXml(markers: Marker[], ctx: ExportContext): string {
  const sel = selectMarkers(markers, ctx.include);
  const durFrames = timeToFrame(ctx.audioDurationSec, ctx.fps, "floor");

  const markerXml = sel
    .map((m) => {
      const inF = timeToFrame(m.timeSec, ctx.fps, ctx.rounding);
      const outF = m.meta?.durationSec
        ? timeToFrame(m.timeSec + m.meta.durationSec, ctx.fps, ctx.rounding)
        : -1;
      return [
        `    <marker>`,
        `      <name>${escapeXml(m.label)}</name>`,
        `      <comment>${escapeXml(`BeatMarks:${m.type}`)}</comment>`,
        `      <in>${inF}</in>`,
        `      <out>${outF}</out>`,
        `    </marker>`,
      ].join("\n");
    })
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE xmeml>`,
    `<xmeml version="4">`,
    `  <sequence id="beatmarks-sequence-1">`,
    `    <name>${escapeXml(`${ctx.baseName}_BeatMarks`)}</name>`,
    `    <duration>${durFrames}</duration>`,
    rateXml(ctx, "    "),
    `    <timecode>`,
    rateXml(ctx, "      "),
    `      <string>00:00:00:00</string>`,
    `      <frame>0</frame>`,
    `      <displayformat>NDF</displayformat>`,
    `    </timecode>`,
    `    <media>`,
    `      <video>`,
    `        <format>`,
    `          <samplecharacteristics>`,
    rateXml(ctx, "            "),
    `            <width>1920</width>`,
    `            <height>1080</height>`,
    `          </samplecharacteristics>`,
    `        </format>`,
    `      </video>`,
    `    </media>`,
    markerXml,
    `  </sequence>`,
    `</xmeml>`,
    ``,
  ].join("\n");
}
