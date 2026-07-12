/** SMF (format 1) エクスポータ。DAW 連携の汎用経路(スペック §8)。
 *  Track0=テンポ/拍子、Track1=マーカーメタ、Track2=拍/小節ノート、Track3=ヒットノート。 */
import type { ExportContext, Marker, TempoPoint } from "../types.js";
import { selectMarkers } from "./helpers.js";

export const TPQ = 480;

const NOTE_BAR = 48;
const NOTE_BEAT = 36;
const NOTE_HIT: Record<string, number> = { low: 35, mid: 38, high: 42 }; // GM kick/snare/hat
const NOTE_LEN_TICKS = 60;
const DRUM_CH = 9; // 0起点(=MIDI ch10)

export function secondsToTicks(
  timeSec: number, tempoMap: TempoPoint[], tpq: number = TPQ,
): number {
  if (tempoMap.length === 0) return Math.round(timeSec * 2 * tpq); // 120bpm相当のフォールバック
  let ticks = 0;
  let prevT = 0;
  let prevBpm = tempoMap[0]!.bpm;
  for (const p of tempoMap) {
    if (p.timeSec >= timeSec) break;
    if (p.timeSec > prevT) {
      ticks += ((p.timeSec - prevT) * prevBpm / 60) * tpq;
      prevT = p.timeSec;
    }
    prevBpm = p.bpm;
  }
  ticks += ((timeSec - prevT) * prevBpm / 60) * tpq;
  return Math.round(ticks);
}

// ---- バイト列組み立て ----
class Bytes {
  private buf: number[] = [];
  u8(...v: number[]) { this.buf.push(...v.map((x) => x & 0xff)); }
  u16(v: number) { this.u8(v >> 8, v); }
  u32(v: number) { this.u8(v >>> 24, v >>> 16, v >>> 8, v); }
  ascii(s: string) { for (const c of s) this.u8(c.charCodeAt(0)); }
  bytes(b: Uint8Array | number[]) { for (const x of b) this.u8(x); }
  vlq(v: number) {
    const stack = [v & 0x7f];
    let rest = Math.floor(v / 128);
    while (rest > 0) { stack.push((rest & 0x7f) | 0x80); rest = Math.floor(rest / 128); }
    stack.reverse();
    this.u8(...stack);
  }
  out(): Uint8Array { return new Uint8Array(this.buf); }
}

interface AbsEvent { tick: number; order: number; bytes: number[] }

function metaEvent(type: number, data: number[] | Uint8Array): number[] {
  const arr = [...data];
  const vlq: number[] = [];
  let v = arr.length;
  const stack = [v & 0x7f];
  v = Math.floor(v / 128);
  while (v > 0) { stack.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
  stack.reverse();
  return [0xff, type, ...stack, ...arr];
}

function trackChunk(events: AbsEvent[]): Uint8Array {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body = new Bytes();
  let prev = 0;
  for (const e of events) {
    body.vlq(e.tick - prev);
    prev = e.tick;
    body.u8(...e.bytes);
  }
  body.vlq(0);
  body.u8(...metaEvent(0x2f, [])); // End of Track
  const data = body.out();
  const chunk = new Bytes();
  chunk.ascii("MTrk");
  chunk.u32(data.length);
  chunk.bytes(data);
  return chunk.out();
}

function noteOnOff(tick: number, note: number, vel: number, ch: number): AbsEvent[] {
  return [
    { tick, order: 1, bytes: [0x90 | ch, note, vel] },
    { tick: tick + NOTE_LEN_TICKS, order: 0, bytes: [0x80 | ch, note, 0] },
  ];
}

const enc = new TextEncoder();

export function exportMidi(markers: Marker[], ctx: ExportContext): Uint8Array {
  const sel = selectMarkers(markers, ctx.include);
  const toTick = (t: number) => secondsToTicks(t, ctx.tempoMap);

  // Track 0: テンポ・拍子
  const t0: AbsEvent[] = [
    { tick: 0, order: 0, bytes: metaEvent(0x03, [...enc.encode("BeatMarks Tempo")]) },
    { tick: 0, order: 1, bytes: metaEvent(0x58, [ctx.beatsPerBar & 0xff, 2, 24, 8]) },
  ];
  for (const p of ctx.tempoMap) {
    const us = Math.round(60_000_000 / p.bpm);
    t0.push({
      tick: toTick(p.timeSec), order: 2,
      bytes: metaEvent(0x51, [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]),
    });
  }

  // Track 1: マーカーメタ(section / silence / custom)
  const t1: AbsEvent[] = [
    { tick: 0, order: 0, bytes: metaEvent(0x03, [...enc.encode("BeatMarks Markers")]) },
  ];
  for (const m of sel) {
    if (m.type !== "section" && m.type !== "silence" && m.type !== "custom") continue;
    t1.push({ tick: toTick(m.timeSec), order: 1, bytes: metaEvent(0x06, [...enc.encode(m.label)]) });
  }

  // Track 2: 拍/小節ノート(同tickの拍は小節頭を優先)
  const t2: AbsEvent[] = [
    { tick: 0, order: 0, bytes: metaEvent(0x03, [...enc.encode("BeatMarks Beats")]) },
  ];
  const barTicks = new Set<number>();
  for (const m of sel) {
    if (m.type === "bar") barTicks.add(toTick(m.timeSec));
  }
  for (const m of sel) {
    if (m.type === "bar") {
      t2.push(...noteOnOff(toTick(m.timeSec), NOTE_BAR, 127, DRUM_CH));
    } else if (m.type === "beat") {
      const tick = toTick(m.timeSec);
      if (!barTicks.has(tick)) t2.push(...noteOnOff(tick, NOTE_BEAT, 80, DRUM_CH));
    }
  }

  // Track 3: ヒットノート
  const t3: AbsEvent[] = [
    { tick: 0, order: 0, bytes: metaEvent(0x03, [...enc.encode("BeatMarks Hits")]) },
  ];
  for (const m of sel) {
    if (m.type !== "hit") continue;
    const note = NOTE_HIT[m.meta?.band ?? "low"] ?? NOTE_HIT["low"]!;
    const vel = Math.min(127, Math.round((m.meta?.strength ?? 0.5) * 126) + 1);
    t3.push(...noteOnOff(toTick(m.timeSec), note, vel, DRUM_CH));
  }

  const tracks = [t0, t1, t2, t3].map(trackChunk);
  const out = new Bytes();
  out.ascii("MThd");
  out.u32(6);
  out.u16(1);              // format 1
  out.u16(tracks.length);  // 常に4
  out.u16(TPQ);
  for (const t of tracks) out.bytes(t);
  return out.out();
}
