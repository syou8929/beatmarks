import { describe, expect, it } from "vitest";

import { exportMidi, secondsToTicks, TPQ } from "../exporters/midi.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker, TempoPoint } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest",
    include: ["section", "bar", "beat", "hit", "silence", "custom"],
    baseName: "track", sourceLabel: null, audioFileName: "track.wav",
    audioDurationSec: 10, bpmLabel: "120.00", keyLabel: "C major (8B)",
    beatsPerBar: 4, tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
    ...over,
  };
}

// ---- テスト用の最小SMFリーダ ----
function readVlq(b: Uint8Array, pos: number): [number, number] {
  let v = 0;
  for (;;) {
    const byte = b[pos++]!;
    v = (v << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return [v, pos];
  }
}

interface Ev { tick: number; kind: string; data: number[]; text?: string }

function parseSmf(bytes: Uint8Array): { format: number; ntrks: number; tpq: number; tracks: Ev[][] } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("MThd");
  const format = dv.getUint16(8);
  const ntrks = dv.getUint16(10);
  const tpq = dv.getUint16(12);
  const tracks: Ev[][] = [];
  let pos = 14;
  for (let t = 0; t < ntrks; t++) {
    expect(String.fromCharCode(...bytes.slice(pos, pos + 4))).toBe("MTrk");
    const len = dv.getUint32(pos + 4);
    let p = pos + 8;
    const end = p + len;
    const evs: Ev[] = [];
    let tick = 0;
    let running = 0;
    while (p < end) {
      const [delta, p2] = readVlq(bytes, p);
      p = p2;
      tick += delta;
      let status = bytes[p]!;
      if (status < 0x80) status = running; else { p++; running = status; }
      if (status === 0xff) {
        const meta = bytes[p++]!;
        const [len2, p3] = readVlq(bytes, p);
        p = p3;
        const data = [...bytes.slice(p, p + len2)];
        p += len2;
        const ev: Ev = { tick, kind: `meta${meta.toString(16)}`, data };
        if (meta === 0x06 || meta === 0x03) {
          ev.text = new TextDecoder().decode(new Uint8Array(data));
        }
        evs.push(ev);
      } else {
        const type = status & 0xf0;
        const n = type === 0xc0 || type === 0xd0 ? 1 : 2;
        evs.push({ tick, kind: `st${type.toString(16)}`, data: [...bytes.slice(p, p + n)] });
        p += n;
      }
    }
    tracks.push(evs);
    pos = end;
  }
  return { format, ntrks, tpq, tracks };
}

describe("secondsToTicks", () => {
  it("固定テンポ: t*bpm/60*TPQ", () => {
    const map: TempoPoint[] = [{ timeSec: 0, bpm: 120 }];
    expect(secondsToTicks(0, map)).toBe(0);
    expect(secondsToTicks(1, map)).toBe(960);
    expect(secondsToTicks(2.5, map)).toBe(2400);
  });

  it("可変テンポ: 区分積分", () => {
    const map: TempoPoint[] = [{ timeSec: 0, bpm: 120 }, { timeSec: 10, bpm: 150 }];
    expect(secondsToTicks(10, map)).toBe(9600);              // 120bpmで10秒
    expect(secondsToTicks(12, map)).toBe(9600 + 2400);       // +150bpmで2秒 = 2.5拍/s*2*480
  });
});

describe("exportMidi", () => {
  const markers: Marker[] = [
    { id: "sec-0", sourceId: "s", timeSec: 0, type: "section", label: "Aメロ",
      color: "#5b7fd4", source: "auto", meta: { durationSec: 4 } },
    { id: "bar-1", sourceId: "s", timeSec: 0.5, type: "bar", label: "小節1",
      color: "#e8ebf0", source: "auto", meta: { barNumber: 1 } },
    { id: "beat-1", sourceId: "s", timeSec: 0.5, type: "beat", label: "拍",
      color: "#8b94a3", source: "auto" }, // 小節頭と同時刻 → ノートは1つだけ
    { id: "beat-2", sourceId: "s", timeSec: 1.0, type: "beat", label: "拍",
      color: "#8b94a3", source: "auto" },
    { id: "hit-low-0", sourceId: "s", timeSec: 2.0, type: "hit", label: "low",
      color: "#ff7847", source: "auto", meta: { strength: 1.0, band: "low" } },
  ];

  it("ヘッダ: format1・4トラック・TPQ", () => {
    const smf = parseSmf(exportMidi(markers, ctx()));
    expect(smf.format).toBe(1);
    expect(smf.ntrks).toBe(4);
    expect(smf.tpq).toBe(TPQ);
  });

  it("Track0: 拍子とテンポ(120bpm=500000μs)", () => {
    const smf = parseSmf(exportMidi(markers, ctx()));
    const tempoEvs = smf.tracks[0]!.filter((e) => e.kind === "meta51");
    expect(tempoEvs).toHaveLength(1);
    const us = (tempoEvs[0]!.data[0]! << 16) | (tempoEvs[0]!.data[1]! << 8) | tempoEvs[0]!.data[2]!;
    expect(us).toBe(500000);
    const ts = smf.tracks[0]!.find((e) => e.kind === "meta58")!;
    expect(ts.data[0]).toBe(4); // beatsPerBar
    expect(ts.data[1]).toBe(2); // 分母4 = 2^2
  });

  it("Track1: セクションがマーカーメタ(UTF-8)", () => {
    const smf = parseSmf(exportMidi(markers, ctx()));
    const ms = smf.tracks[1]!.filter((e) => e.kind === "meta6");
    expect(ms).toHaveLength(1);
    expect(ms[0]!.text).toBe("Aメロ");
    expect(ms[0]!.tick).toBe(0);
  });

  it("Track2: 小節頭48/拍36、同時刻は小節頭のみ", () => {
    const smf = parseSmf(exportMidi(markers, ctx()));
    const ons = smf.tracks[2]!.filter((e) => e.kind === "st90" && e.data[1]! > 0);
    expect(ons).toHaveLength(2); // bar@0.5, beat@1.0(重複beat@0.5は出ない)
    expect(ons[0]!.data[0]).toBe(48);
    expect(ons[0]!.tick).toBe(480); // 0.5s @120bpm = 0.5*120/60*480
    expect(ons[1]!.data[0]).toBe(36);
  });

  it("Track3: ヒットはGMドラムノート・強度→ベロシティ", () => {
    const smf = parseSmf(exportMidi(markers, ctx()));
    const ons = smf.tracks[3]!.filter((e) => e.kind === "st90" && e.data[1]! > 0);
    expect(ons).toHaveLength(1);
    expect(ons[0]!.data[0]).toBe(35);   // low
    expect(ons[0]!.data[1]).toBe(127);  // 1.0*126+1
  });

  it("includeで種別を絞ってもトラック数は4", () => {
    const smf = parseSmf(exportMidi(markers, ctx({ include: ["section"] })));
    expect(smf.ntrks).toBe(4);
    expect(smf.tracks[2]!.filter((e) => e.kind === "st90")).toHaveLength(0);
  });
});
