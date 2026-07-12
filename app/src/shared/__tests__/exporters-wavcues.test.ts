import { describe, expect, it } from "vitest";

import { ExportError } from "../exporters/helpers.js";
import { embedWavCues } from "../exporters/wavCues.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest",
    include: ["section", "bar", "custom"],
    baseName: "track", sourceLabel: null, audioFileName: "track.wav",
    audioDurationSec: 2, bpmLabel: "120.00", keyLabel: "C major (8B)",
    beatsPerBar: 4, tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
    ...over,
  };
}

// ---- テスト用の最小WAVビルダ/リーダ ----
function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function u32le(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
}

function u16le(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff];
}

/** 22050Hz mono 16bit PCM、nサンプルのWAV */
function makeWav(nSamples: number, sampleRate = 22050): Uint8Array {
  const dataLen = nSamples * 2;
  const fmt = [
    ...ascii("fmt "), ...u32le(16),
    ...u16le(1), ...u16le(1), ...u32le(sampleRate),
    ...u32le(sampleRate * 2), ...u16le(2), ...u16le(16),
  ];
  const data = [...ascii("data"), ...u32le(dataLen), ...new Array(dataLen).fill(0x42)];
  const body = [...ascii("WAVE"), ...fmt, ...data];
  return new Uint8Array([...ascii("RIFF"), ...u32le(body.length), ...body]);
}

interface Chunk { id: string; start: number; size: number }

function chunks(bytes: Uint8Array): Chunk[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Chunk[] = [];
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.slice(pos, pos + 4));
    const size = dv.getUint32(pos + 4, true);
    out.push({ id, start: pos + 8, size });
    pos += 8 + size + (size % 2);
  }
  return out;
}

const MARKERS: Marker[] = [
  { id: "sec-0", sourceId: "s", timeSec: 0.5, type: "section", label: "サビ",
    color: "#e4547c", source: "auto", meta: { durationSec: 1.0 } },
  { id: "bar-1", sourceId: "s", timeSec: 1.0, type: "bar", label: "小節1",
    color: "#e8ebf0", source: "auto", meta: { barNumber: 1 } },
];

describe("embedWavCues", () => {
  it("cueチャンクとadtlが追加され、位置がサンプル単位で正しい", () => {
    const src = makeWav(44100); // 2秒
    const out = embedWavCues(src, MARKERS, ctx());
    const cs = chunks(out);
    const cue = cs.find((c) => c.id === "cue ")!;
    expect(cue).toBeDefined();
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(dv.getUint32(cue.start, true)).toBe(2); // マーカー数
    // 1個目: id=1, position=round(0.5*22050)=11025
    expect(dv.getUint32(cue.start + 4, true)).toBe(1);
    expect(dv.getUint32(cue.start + 8, true)).toBe(11025);
    // dwSampleOffset(cueレコード末尾)も同じ
    expect(dv.getUint32(cue.start + 4 + 20, true)).toBe(11025);
    const list = cs.find((c) => c.id === "LIST")!;
    expect(String.fromCharCode(...out.slice(list.start, list.start + 4))).toBe("adtl");
  });

  it("lablにUTF-8ラベル、リージョンにはltxt", () => {
    const out = embedWavCues(makeWav(44100), MARKERS, ctx());
    const text = new TextDecoder().decode(out);
    expect(text).toContain("labl");
    expect(text).toContain("サビ");
    expect(text).toContain("ltxt");
    expect(text).toContain("rgn ");
  });

  it("dataチャンクはバイト無変更・RIFFサイズ整合", () => {
    const src = makeWav(1000);
    const out = embedWavCues(src, MARKERS, ctx());
    const dataIn = chunks(src).find((c) => c.id === "data")!;
    const dataOut = chunks(out).find((c) => c.id === "data")!;
    expect(out.slice(dataOut.start, dataOut.start + dataOut.size))
      .toEqual(src.slice(dataIn.start, dataIn.start + dataIn.size));
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(dv.getUint32(4, true)).toBe(out.length - 8);
    expect(out.length % 2).toBe(0);
  });

  it("再埋め込みで既存cue/adtlが置き換わる(重複しない)", () => {
    const once = embedWavCues(makeWav(44100), MARKERS, ctx());
    const twice = embedWavCues(once, MARKERS, ctx());
    expect(chunks(twice).filter((c) => c.id === "cue ")).toHaveLength(1);
    expect(twice.length).toBe(once.length);
  });

  it("includeで絞られる", () => {
    const out = embedWavCues(makeWav(44100), MARKERS, ctx({ include: ["bar"] }));
    const cue = chunks(out).find((c) => c.id === "cue ")!;
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(dv.getUint32(cue.start, true)).toBe(1);
  });

  it("WAVでないバイト列はExportError", () => {
    expect(() => embedWavCues(new Uint8Array([1, 2, 3]), MARKERS, ctx())).toThrow(ExportError);
    const notWave = new Uint8Array([...ascii("RIFF"), ...u32le(4), ...ascii("AVI ")]);
    expect(() => embedWavCues(notWave, MARKERS, ctx())).toThrow(ExportError);
  });

  it("奇数長の未知チャンクがパディング込みで無傷に往復する", () => {
    // fmtとdataの間に5バイトの'junk'チャンク(奇数長→1バイトパディング)を挟む
    const base = makeWav(1000);
    const cs = chunks(base);
    const fmtEnd = cs.find((c) => c.id === "fmt ")!.start + 16;
    const junk = [...ascii("junk"), ...u32le(5), 1, 2, 3, 4, 5, 0]; // 実体5+pad1
    const withJunk = new Uint8Array([
      ...base.slice(0, fmtEnd), ...junk, ...base.slice(fmtEnd),
    ]);
    // RIFFサイズを増分修正
    const dv0 = new DataView(withJunk.buffer);
    dv0.setUint32(4, withJunk.length - 8, true);
    const out = embedWavCues(withJunk, MARKERS, ctx());
    const outChunks = chunks(out);
    const junkOut = outChunks.find((c) => c.id === "junk")!;
    expect(junkOut).toBeDefined();
    expect(junkOut.size).toBe(5);
    expect([...out.slice(junkOut.start, junkOut.start + 5)]).toEqual([1, 2, 3, 4, 5]);
    expect(out.length % 2).toBe(0);
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(dv.getUint32(4, true)).toBe(out.length - 8);
  });

  it("5MB級のdataチャンクでも正しく高速に往復する", () => {
    const big = makeWav(2_500_000); // 5MB data
    const t0 = performance.now();
    const out = embedWavCues(big, MARKERS, ctx());
    const elapsed = performance.now() - t0;
    const dataIn = chunks(big).find((c) => c.id === "data")!;
    const dataOut = chunks(out).find((c) => c.id === "data")!;
    expect(dataOut.size).toBe(dataIn.size);
    // 先頭/末尾/中間のサンプル一致(全量toEqualはテスト自体が重いので点検査)
    for (const off of [0, 1, 999_999, dataIn.size - 1]) {
      expect(out[dataOut.start + off]).toBe(big[dataIn.start + off]);
    }
    expect(elapsed).toBeLessThan(2000); // 旧実装は数十秒〜、新実装は数十ms想定の粗い上限
  });
});
