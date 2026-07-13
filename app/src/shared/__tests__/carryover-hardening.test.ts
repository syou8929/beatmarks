import { describe, expect, it } from "vitest";

import { exportAudacityTxt } from "../exporters/audacityTxt.js";
import { exportBlenderPy } from "../exporters/blenderPy.js";
import { csvField } from "../exporters/helpers.js";
import { exportMidi } from "../exporters/midi.js";
import { exportReaperCsv } from "../exporters/reaperCsv.js";
import { exportResolveEdl } from "../exporters/resolveEdl.js";
import { formatTimecode, FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest",
    include: ["section", "bar", "custom"],
    baseName: "t", sourceLabel: null, audioFileName: "t.wav",
    audioDurationSec: 10, bpmLabel: "120.00", keyLabel: "C major (8B)",
    beatsPerBar: 4, timeSigDenominator: 4,
    tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
    ...over,
  };
}

const NASTY: Marker[] = [{
  id: "c1", sourceId: "s", timeSec: 1, type: "custom",
  label: "bad\rlabel|pipe\nnl", color: "#ffd166", source: "user",
}];

describe("拍子分母(MIDI 6/8)", () => {
  function timeSigOf(bytes: Uint8Array): [number, number] {
    // FF 58 04 nn dd ... を素朴に探す
    for (let i = 0; i < bytes.length - 4; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0x58) {
        return [bytes[i + 3]!, bytes[i + 4]!];
      }
    }
    throw new Error("time sig not found");
  }

  it("6/8はnn=6, dd=3", () => {
    const smf = exportMidi([], ctx({ beatsPerBar: 6, timeSigDenominator: 8 }));
    expect(timeSigOf(smf)).toEqual([6, 3]);
  });

  it("4/4はnn=4, dd=2(既定・ゴールデン不変)", () => {
    const smf = exportMidi([], ctx());
    expect(timeSigOf(smf)).toEqual([4, 2]);
  });
});

describe("ラベル強化", () => {
  it("csvFieldは\\rでもクオート", () => {
    expect(csvField("a\rb")).toBe('"a\rb"');
  });

  it("reaper/audacityは\\rも空白化し行数が増えない", () => {
    const rows = exportReaperCsv(NASTY, ctx({ include: ["custom"] })).trimEnd().split("\n");
    expect(rows).toHaveLength(2); // header + 1
    const rows2 = exportAudacityTxt(NASTY, ctx({ include: ["custom"] })).trimEnd().split("\n");
    expect(rows2).toHaveLength(1);
  });

  it("resolveEdlはラベルの|と改行を無害化", () => {
    const edl = exportResolveEdl(NASTY, ctx({ include: ["custom"] }));
    // ラベル内の | は全角(U+FF5C)へ、改行は空白へ置換される
    expect(edl).toContain("|M:bad label｜pipe nl");
    // コメント行のフィールド区切り(半角|)はC/M/Dの3つのまま
    const comment = edl.split("\r\n").find((l) => l.includes("|M:"))!;
    expect(comment.match(/\|/g)!.length).toBe(3);
  });

  it("blenderPyのヘッダコメントに生の改行が注入されない", () => {
    const py = exportBlenderPy([], ctx({ bpmLabel: "120\nimport os" }));
    for (const line of py.split("\n")) {
      if (line.includes("BPM")) expect(line.startsWith("#")).toBe(true);
    }
    expect(py).not.toContain("\nimport os"); // 素の注入なし(エスケープ済み)
  });
});

describe("formatTimecode負値クランプ", () => {
  it("負フレームは00:00:00:00", () => {
    expect(formatTimecode(-150, FPS_PRESETS["30"]!)).toBe("00:00:00:00");
  });
});
