import { describe, expect, it } from "vitest";

import { exportCsv } from "../exporters/csv.js";
import { exportJson } from "../exporters/json.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!,
    rounding: "nearest",
    include: ["section", "bar", "beat", "hit", "silence", "custom"],
    baseName: "track",
    sourceLabel: null,
    audioFileName: "track.wav",
    audioDurationSec: 10,
    bpmLabel: "120.00",
    keyLabel: "C major (8B)",
    beatsPerBar: 4,
    tempoMap: [{ timeSec: 0, bpm: 120 }],
    envelopes: null,
    ...over,
  };
}

const MARKERS: Marker[] = [
  { id: "sec-0", sourceId: "s", timeSec: 0, type: "section", label: "A", color: "#5b7fd4",
    source: "auto", meta: { durationSec: 4.25 } },
  { id: "bar-1", sourceId: "s", timeSec: 0.25, type: "bar", label: "小節1", color: "#e8ebf0",
    source: "auto", meta: { barNumber: 1 } },
  { id: "hit-low-0", sourceId: "s", timeSec: 1.5, type: "hit", label: "low", color: "#ff7847",
    source: "auto", meta: { strength: 0.92, band: "low" } },
  { id: "custom-1", sourceId: "s", timeSec: 2, type: "custom", label: 'say "hi", ok',
    color: "#ffd166", source: "user" },
];

describe("exportJson", () => {
  it("正規JSONの形とフレーム/タイムコード併記", () => {
    const parsed = JSON.parse(exportJson(MARKERS, ctx()));
    expect(parsed.format).toBe("beatmarks-markers");
    expect(parsed.version).toBe(1);
    expect(parsed.fps).toEqual({ num: 30, den: 1, label: "30" });
    expect(parsed.markers).toHaveLength(4);
    const bar = parsed.markers[1];
    expect(bar).toMatchObject({
      id: "bar-1", type: "bar", timeSec: 0.25, frame: 8, timecode: "00:00:00:08",
      barNumber: 1,
    });
    const sec = parsed.markers[0];
    expect(sec.durationSec).toBeCloseTo(4.25);
    expect(sec.frameOut).toBe(128); // round(4.25*30)
    expect(parsed.markers[2].strength).toBeCloseTo(0.92);
  });

  it("includeで種別を絞れる", () => {
    const parsed = JSON.parse(exportJson(MARKERS, ctx({ include: ["hit"] })));
    expect(parsed.markers).toHaveLength(1);
    expect(parsed.markers[0].type).toBe("hit");
  });

  it("29.97ではフレームが分数計算", () => {
    const parsed = JSON.parse(exportJson(MARKERS, ctx({ fps: FPS_PRESETS["29.97"]! })));
    expect(parsed.markers[1].frame).toBe(Math.round((0.25 * 30000) / 1001)); // 7
    expect(parsed.fps.label).toBe("29.97");
  });

  it("スペック§8: tempoMapとenvelopesを含む(envelopesはnull可)", () => {
    const parsed = JSON.parse(exportJson(MARKERS, ctx()));
    expect(parsed.tempoMap).toEqual([{ timeSec: 0, bpm: 120 }]);
    expect(parsed.envelopes).toBeNull();
    const env = {
      sampleRateHz: 100,
      total: [0.5, 0.5], low: [0.1, 0.1], mid: [0.1, 0.1], high: [0.1, 0.1],
    };
    const withEnv = JSON.parse(exportJson(MARKERS, ctx({ envelopes: env })));
    expect(withEnv.envelopes).toEqual(env);
  });
});

describe("exportCsv", () => {
  it("ヘッダ・エスケープ・改行", () => {
    const text = exportCsv(MARKERS, ctx());
    const lines = text.split("\n");
    expect(lines[0]).toBe("time_sec,frame,timecode,type,label,color,strength,source");
    expect(lines[1]).toBe("0.000,0,00:00:00:00,section,A,#5b7fd4,,auto");
    expect(lines[2]).toBe("0.250,8,00:00:00:08,bar,小節1,#e8ebf0,,auto");
    expect(lines[3]).toBe("1.500,45,00:00:01:15,hit,low,#ff7847,0.92,auto");
    expect(lines[4]).toBe('2.000,60,00:00:02:00,custom,"say ""hi"", ok",#ffd166,,user');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("floor丸めが効く", () => {
    const m: Marker[] = [{ id: "b", sourceId: "s", timeSec: 0.9999, type: "beat",
      label: "拍", color: "#8b94a3", source: "auto" }];
    const text = exportCsv(m, ctx({ rounding: "floor", include: ["beat"] }));
    expect(text.split("\n")[1]).toContain(",29,"); // floor(29.997)
  });
});
