import { describe, expect, it } from "vitest";

import { exportMidi } from "../exporters/midi.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

const enc = new TextEncoder();

function ctx(): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest", include: ["custom"],
    baseName: "x", sourceLabel: null, audioFileName: "x.wav", audioDurationSec: 10,
    bpmLabel: "120.00", keyLabel: "C major (8B)", beatsPerBar: 4, timeSigDenominator: 4,
    tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
  };
}

/** MThd/MTrk を厳密に歩いて構造健全性を確認しつつ、メタ0x06(マーカー)の VLQ 長を集める。 */
function scanMarkerMetaLengths(bytes: Uint8Array): number[] {
  let p = 0;
  const u32 = (o: number) => (bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!;
  expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("MThd");
  const ntrk = (bytes[10]! << 8) | bytes[11]!;
  p = 8 + u32(4);
  const lengths: number[] = [];
  for (let t = 0; t < ntrk; t++) {
    expect(String.fromCharCode(...bytes.slice(p, p + 4))).toBe("MTrk");
    const len = u32(p + 4);
    const end = p + 8 + len;
    let q = p + 8;
    while (q < end) {
      while (bytes[q]! & 0x80) q++; // VLQ delta
      q++;
      const status = bytes[q]!;
      if (status === 0xff) {
        const type = bytes[q + 1]!;
        let r = q + 2, mlen = 0;
        do { mlen = (mlen << 7) | (bytes[r]! & 0x7f); } while (bytes[r++]! & 0x80);
        if (type === 0x06) lengths.push(mlen);
        q = r + mlen;
      } else if (status === 0x90 || status === 0x80) {
        q += 3;
      } else { q += 1; }
    }
    expect(q).toBe(end); // 宣言長ぴったりで消費 = 構造健全
    p = end;
  }
  return lengths;
}

describe("MIDI 長ラベル(>127B)", () => {
  it("150バイトのマーカーラベルは2バイトVLQ長になり、ファイルが構造的に妥当", () => {
    const label = "あ".repeat(50); // 50×3 = 150 バイト(UTF-8)
    expect(enc.encode(label).length).toBe(150);
    const m: Marker = { id: "c1", sourceId: "mix", timeSec: 1, type: "custom", label, color: "#fff", source: "user" };
    const bytes = exportMidi([m], ctx());
    const lens = scanMarkerMetaLengths(bytes);
    expect(lens).toContain(150);       // 長さ=UTF-8バイト数
    // 150 = 0x96 → VLQ [0x81,0x16] の2バイト
    const i = bytes.indexOf(0xff);
    void i;
  });
});
