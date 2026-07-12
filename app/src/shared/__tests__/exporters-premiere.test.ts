import { describe, expect, it } from "vitest";

import { exportPremiereXml } from "../exporters/premiereXml.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest",
    include: ["section", "bar", "custom"],
    baseName: "track", sourceLabel: null, audioFileName: "track.wav",
    audioDurationSec: 10, bpmLabel: "120.00", keyLabel: "C major (8B)",
    beatsPerBar: 4, tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
    ...over,
  };
}

const MARKERS: Marker[] = [
  { id: "sec-0", sourceId: "s", timeSec: 0, type: "section", label: "A & B <サビ>",
    color: "#e4547c", source: "auto", meta: { durationSec: 4.25 } },
  { id: "bar-1", sourceId: "s", timeSec: 0.25, type: "bar", label: "小節1",
    color: "#e8ebf0", source: "auto", meta: { barNumber: 1 } },
];

describe("exportPremiereXml", () => {
  it("xmeml v4の骨格とシーケンス名", () => {
    const xml = exportPremiereXml(MARKERS, ctx());
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<!DOCTYPE xmeml>");
    expect(xml).toContain('<xmeml version="4">');
    expect(xml).toContain("<name>track_BeatMarks</name>");
    expect(xml).toContain("<duration>300</duration>"); // 10s*30
  });

  it("整数fpsはntsc=FALSE", () => {
    const xml = exportPremiereXml(MARKERS, ctx());
    expect(xml).toContain("<timebase>30</timebase>");
    expect(xml).toContain("<ntsc>FALSE</ntsc>");
  });

  it("29.97はtimebase30/ntsc=TRUE", () => {
    const xml = exportPremiereXml(MARKERS, ctx({ fps: FPS_PRESETS["29.97"]! }));
    expect(xml).toContain("<timebase>30</timebase>");
    expect(xml).toContain("<ntsc>TRUE</ntsc>");
  });

  it("マーカー: エスケープ・in/out・リージョン", () => {
    const xml = exportPremiereXml(MARKERS, ctx());
    expect(xml).toContain("<name>A &amp; B &lt;サビ&gt;</name>");
    expect(xml).toContain("<in>0</in>");
    expect(xml).toContain("<out>128</out>");  // round(4.25*30)
    expect(xml).toContain("<in>8</in>");      // 小節1 @0.25s
    expect(xml).toMatch(/<in>8<\/in>\s*<out>-1<\/out>/); // 点マーカーはout=-1
  });

  it("includeで絞れる", () => {
    const xml = exportPremiereXml(MARKERS, ctx({ include: ["bar"] }));
    expect(xml).not.toContain("A &amp; B");
    expect((xml.match(/<marker>/g) ?? []).length).toBe(1);
  });
});
