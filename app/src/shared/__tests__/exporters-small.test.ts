import { describe, expect, it } from "vitest";

import { exportAudacityTxt } from "../exporters/audacityTxt.js";
import { exportBlenderPy } from "../exporters/blenderPy.js";
import { ExportError } from "../exporters/helpers.js";
import { exportNuendoCsv } from "../exporters/nuendoCsv.js";
import { exportReaperCsv } from "../exporters/reaperCsv.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest",
    include: ["section", "bar", "custom"],
    baseName: "track", sourceLabel: null, audioFileName: "track.wav",
    audioDurationSec: 10, bpmLabel: "120.00", keyLabel: "C major (8B)",
    beatsPerBar: 4, timeSigDenominator: 4, tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
    ...over,
  };
}

const MARKERS: Marker[] = [
  { id: "sec-0", sourceId: "s", timeSec: 0, type: "section", label: "サビ 'A'",
    color: "#e4547c", source: "auto", meta: { durationSec: 4.25 } },
  { id: "bar-1", sourceId: "s", timeSec: 0.25, type: "bar", label: "小節1",
    color: "#e8ebf0", source: "auto", meta: { barNumber: 1 } },
];

describe("exportBlenderPy", () => {
  it("fps設定・マーカー生成・frame_end", () => {
    const py = exportBlenderPy(MARKERS, ctx());
    expect(py).toContain("import bpy");
    expect(py).toContain("scene.render.fps = 30");
    expect(py).toContain("scene.render.fps_base = 1.0");
    expect(py).toContain("timeline_markers.new");
    expect(py).toContain("frame=8"); // 小節1 @0.25s*30
    expect(py).toContain("scene.frame_end = 300");
    expect(py).toContain("ADD_SOUND = False");
  });

  it("29.97はfps_base=1.001", () => {
    const py = exportBlenderPy(MARKERS, ctx({ fps: FPS_PRESETS["29.97"]! }));
    expect(py).toContain("scene.render.fps = 30");
    expect(py).toContain("scene.render.fps_base = 1.001");
  });

  it("ラベルはPython文字列リテラルとして正しく埋め込まれる", () => {
    const py = exportBlenderPy(MARKERS, ctx());
    expect(py).toContain(`timeline_markers.new("サビ 'A'", frame=0)`);
    expect(py).toContain(`timeline_markers.new("小節1", frame=8)`);
    const withQuote: Marker[] = [{ ...MARKERS[1]!, label: 'say "hi"' }];
    expect(exportBlenderPy(withQuote, ctx({ include: ["bar"] })))
      .toContain(`timeline_markers.new("say \\"hi\\"", frame=8)`);
  });
});

describe("exportReaperCsv", () => {
  it("タブ区切り・ヘッダ・リージョンと点", () => {
    const text = exportReaperCsv(MARKERS, ctx());
    const lines = text.split("\n");
    expect(lines[0]).toBe("Name\tStart\tEnd\tLength\tColor\tType");
    expect(lines[1]).toBe("サビ 'A'\t0.000000\t4.250000\t4.250000\t#e4547c\tsection");
    expect(lines[2]).toBe("小節1\t0.250000\t0.250000\t0.000000\t#e8ebf0\tbar");
  });
});

describe("exportNuendoCsv", () => {
  it("タイムコード列で出力", () => {
    const text = exportNuendoCsv(MARKERS, ctx());
    const lines = text.split("\n");
    expect(lines[0]).toBe("Name,Start,End,Length,Description");
    expect(lines[1]).toBe('サビ \'A\',00:00:00:00,00:00:04:08,00:00:04:08,BeatMarks:section');
    expect(lines[2]).toBe("小節1,00:00:00:08,00:00:00:08,00:00:00:00,BeatMarks:bar");
  });

  it("非対応fps(60)はExportError", () => {
    expect(() => exportNuendoCsv(MARKERS, ctx({ fps: FPS_PRESETS["60"]! }))).toThrow(ExportError);
    expect(() => exportNuendoCsv(MARKERS, ctx({ fps: FPS_PRESETS["29.97"]! }))).not.toThrow();
  });

  it("カンマを含むラベルはクオート", () => {
    const m: Marker[] = [{ ...MARKERS[1]!, label: "a,b" }];
    expect(exportNuendoCsv(m, ctx({ include: ["bar"] }))).toContain('"a,b",00:00:00:08');
  });
});

describe("exportAudacityTxt", () => {
  it("start TAB end TAB label", () => {
    const text = exportAudacityTxt(MARKERS, ctx());
    const lines = text.split("\n");
    expect(lines[0]).toBe("0.000000\t4.250000\tサビ 'A'");
    expect(lines[1]).toBe("0.250000\t0.250000\t小節1");
    expect(text.endsWith("\n")).toBe(true);
  });
});
