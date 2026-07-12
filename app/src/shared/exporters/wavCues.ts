/** WAV キューポイント埋め込み(スペック §8)。元 WAV のコピーに cue / LIST(adtl)
 *  チャンクを書き込む。音声データ自体は無変更なので位置ズレが原理的に起きない。
 *  Logic の「オーディオファイルからマーカーを読み込む」、REAPER のメディアキュー
 *  変換などで読める。 */
import type { ExportContext, Marker } from "../types.js";
import { ExportError, selectMarkers } from "./helpers.js";

const enc = new TextEncoder();

class ByteWriter {
  private buf = new Uint8Array(1024);
  private len = 0;

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  ascii(s: string) {
    this.ensure(s.length);
    for (let i = 0; i < s.length; i++) this.buf[this.len++] = s.charCodeAt(i) & 0xff;
  }
  u16(v: number) {
    this.ensure(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >> 8) & 0xff;
  }
  u32(v: number) {
    this.ensure(4);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >> 8) & 0xff;
    this.buf[this.len++] = (v >> 16) & 0xff;
    this.buf[this.len++] = (v >>> 24) & 0xff;
  }
  bytes(b: Uint8Array | number[]) {
    if (b instanceof Uint8Array) {
      this.ensure(b.length);
      this.buf.set(b, this.len);      // バルクコピー(要素pushしない)
      this.len += b.length;
    } else {
      this.ensure(b.length);
      for (const x of b) this.buf[this.len++] = x & 0xff;
    }
  }
  /** 後からサイズを書き戻す(RIFFヘッダ用) */
  patchU32(offset: number, v: number) {
    this.buf[offset] = v & 0xff;
    this.buf[offset + 1] = (v >> 8) & 0xff;
    this.buf[offset + 2] = (v >> 16) & 0xff;
    this.buf[offset + 3] = (v >>> 24) & 0xff;
  }
  get length(): number { return this.len; }
  out(): Uint8Array { return this.buf.slice(0, this.len); }
}

interface RawChunk { id: string; body: Uint8Array }

function parseWav(bytes: Uint8Array): { chunks: RawChunk[] } {
  if (bytes.length < 12) throw new ExportError("WAVとして短すぎます");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new ExportError("RIFF/WAVE ではありません");
  }
  const chunks: RawChunk[] = [];
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = tag(pos);
    const size = dv.getUint32(pos + 4, true);
    const body = bytes.slice(pos + 8, pos + 8 + size);
    chunks.push({ id, body });
    pos += 8 + size + (size % 2);
  }
  return { chunks };
}

function sampleRateOf(chunks: RawChunk[]): number {
  const fmt = chunks.find((c) => c.id === "fmt ");
  if (!fmt || fmt.body.length < 8) throw new ExportError("fmt チャンクがありません");
  const dv = new DataView(fmt.body.buffer, fmt.body.byteOffset, fmt.body.byteLength);
  return dv.getUint32(4, true);
}

function isAdtlList(c: RawChunk): boolean {
  return c.id === "LIST" && c.body.length >= 4 &&
    String.fromCharCode(...c.body.slice(0, 4)) === "adtl";
}

function zstrPadded(s: string): Uint8Array {
  const raw = enc.encode(s);
  const len = raw.length + 1;             // NUL終端
  const padded = len + (len % 2);         // 偶数長
  const out = new Uint8Array(padded);
  out.set(raw, 0);
  return out;
}

export function embedWavCues(
  wavBytes: Uint8Array, markers: Marker[], ctx: ExportContext,
): Uint8Array {
  const { chunks } = parseWav(wavBytes);
  const sr = sampleRateOf(chunks);
  const keep = chunks.filter((c) => c.id !== "cue " && !isAdtlList(c));
  const sel = selectMarkers(markers, ctx.include);

  // cue チャンク
  const cue = new ByteWriter();
  cue.u32(sel.length);
  sel.forEach((m, i) => {
    const sample = Math.round(m.timeSec * sr);
    cue.u32(i + 1);      // dwName (cue id)
    cue.u32(sample);     // dwPosition
    cue.ascii("data");   // fccChunk
    cue.u32(0);          // dwChunkStart
    cue.u32(0);          // dwBlockStart
    cue.u32(sample);     // dwSampleOffset
  });

  // LIST(adtl)
  const adtl = new ByteWriter();
  adtl.ascii("adtl");
  sel.forEach((m, i) => {
    const label = zstrPadded(m.label);
    adtl.ascii("labl");
    adtl.u32(4 + label.length);
    adtl.u32(i + 1);
    adtl.bytes(label);
    if (m.meta?.durationSec) {
      const lenSamples = Math.round(m.meta.durationSec * sr);
      adtl.ascii("ltxt");
      adtl.u32(20);        // テキストなしの固定部のみ
      adtl.u32(i + 1);
      adtl.u32(lenSamples);
      adtl.ascii("rgn ");
      adtl.u16(0); adtl.u16(0); adtl.u16(0); adtl.u16(0); // country/lang/dialect/codepage
    }
  });

  // 再構築(単一の writer に直接書く。out→file の二重ラップを排除)
  const w = new ByteWriter();
  w.ascii("RIFF");
  w.u32(0); // 後でpatch
  w.ascii("WAVE");
  for (const c of keep) {
    w.ascii(c.id);
    w.u32(c.body.length);
    w.bytes(c.body);
    if (c.body.length % 2 === 1) w.bytes([0]); // 奇数長チャンクは偶数へパディング
  }
  const cueBody = cue.out();
  w.ascii("cue ");
  w.u32(cueBody.length);
  w.bytes(cueBody);
  if (cueBody.length % 2 === 1) w.bytes([0]);
  const adtlBody = adtl.out();
  w.ascii("LIST");
  w.u32(adtlBody.length);
  w.bytes(adtlBody);
  if (adtlBody.length % 2 === 1) w.bytes([0]);
  w.patchU32(4, w.length - 8);
  return w.out();
}
