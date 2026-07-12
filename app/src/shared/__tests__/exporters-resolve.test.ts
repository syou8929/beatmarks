import { describe, expect, it } from "vitest";

import { exportResolveEdl } from "../exporters/resolveEdl.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest",
    include: ["section", "bar", "hit"],
    baseName: "track", sourceLabel: null, audioFileName: "track.wav",
    audioDurationSec: 10, bpmLabel: "120.00", keyLabel: "C major (8B)",
    beatsPerBar: 4, tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
    ...over,
  };
}

const MARKERS: Marker[] = [
  { id: "sec-0", sourceId: "s", timeSec: 0, type: "section", label: "サビ ★",
    color: "#e4547c", source: "auto", meta: { durationSec: 4.25 } },
  { id: "bar-1", sourceId: "s", timeSec: 0.25, type: "bar", label: "小節1",
    color: "#e8ebf0", source: "auto", meta: { barNumber: 1 } },
  { id: "hit-low-0", sourceId: "s", timeSec: 1.5, type: "hit", label: "low",
    color: "#ff7847", source: "auto", meta: { strength: 0.9, band: "low" } },
];

describe("exportResolveEdl", () => {
  it("ヘッダとCRLF", () => {
    const edl = exportResolveEdl(MARKERS, ctx());
    expect(edl.startsWith("TITLE: track_BeatMarks\r\n")).toBe(true);
    expect(edl).toContain("FCM: NON-DROP FRAME\r\n");
    expect(edl).not.toMatch(/[^\r]\n/); // 生LFなし(すべてCRLF)
  });

  it("イベント行: 連番・TC・コメント行のメタ", () => {
    const edl = exportResolveEdl(MARKERS, ctx());
    expect(edl).toContain("001  001      V     C        00:00:00:00 00:00:04:08 00:00:00:00 00:00:04:08");
    expect(edl).toContain("|C:ResolveColorRose |M:サビ ★ |D:128"); // round(4.25*30)=128
    expect(edl).toContain("002  001      V     C        00:00:00:08 00:00:00:09 00:00:00:08 00:00:00:09");
    expect(edl).toContain("|D:1"); // 点マーカーは1フレーム
  });

  it("色マップ: 未知色はBlue、既知パレットは対応色", () => {
    const edl = exportResolveEdl(MARKERS, ctx());
    expect(edl).toContain("ResolveColorRose");   // #e4547c
    expect(edl).toContain("ResolveColorCream");  // #e8ebf0
    expect(edl).toContain("ResolveColorRed");    // #ff7847
    const unknown: Marker[] = [{ ...MARKERS[1]!, color: "#010203" }];
    expect(exportResolveEdl(unknown, ctx({ include: ["bar"] }))).toContain("ResolveColorBlue");
  });

  it("29.97でもTCはノンドロップのベース30", () => {
    const edl = exportResolveEdl(MARKERS, ctx({ fps: FPS_PRESETS["29.97"]!, include: ["bar"] }));
    expect(edl).toContain("00:00:00:07"); // round(0.25*30000/1001)=7
  });
});
