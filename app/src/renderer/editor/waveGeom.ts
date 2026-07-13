/** メイン波形の座標系(sec↔px)・可視要素抽出・ヒットテスト・描画(スペック §7)。
 *  純ロジックに寄せ、WaveCanvas は薄い描画層にする。 */
import type { GridBeat } from "../../shared/deriveGrid.js";
import { BAR_COLOR, BEAT_COLOR } from "../../shared/deriveMarkers.js";
import type { Marker, MarkerType } from "../../shared/types.js";
import { pickLevel, type PeakSet } from "./peaks.js";

export interface Viewport {
  scrollSec: number;
  samplesPerPx: number;
  sampleRate: number;
  widthPx: number;
}

export function secToPx(sec: number, vp: Viewport): number {
  return ((sec - vp.scrollSec) * vp.sampleRate) / vp.samplesPerPx;
}
export function pxToSec(px: number, vp: Viewport): number {
  return vp.scrollSec + (px * vp.samplesPerPx) / vp.sampleRate;
}
export function visibleRange(vp: Viewport): { fromSec: number; toSec: number } {
  return { fromSec: vp.scrollSec, toSec: pxToSec(vp.widthPx, vp) };
}

/** カーソル中心ズーム: factor>1=拡大(密度↓)。anchorPx の時刻を不変に保つ。 */
export function zoomAt(vp: Viewport, factor: number, anchorPx: number): Viewport {
  const anchorSec = pxToSec(anchorPx, vp);
  const samplesPerPx = vp.samplesPerPx / factor;
  const scrollSec = anchorSec - (anchorPx * samplesPerPx) / vp.sampleRate;
  return { ...vp, samplesPerPx, scrollSec };
}

export interface GridLine { px: number; isBar: boolean; barNumber: number; free: boolean }
export function visibleGridLines(grid: GridBeat[], vp: Viewport): GridLine[] {
  const out: GridLine[] = [];
  for (const g of grid) {
    const px = secToPx(g.timeSec, vp);
    if (px >= -1 && px <= vp.widthPx + 1) {
      out.push({ px, isBar: g.isBar, barNumber: g.barNumber, free: g.free });
    }
  }
  return out;
}

/** 小節番号ラベルの間引きステップ(ラベルが最低 minLabelPx 間隔になるように)。 */
export function adaptiveBarStep(barIntervalSec: number, vp: Viewport, minLabelPx = 60): number {
  const barPx = (barIntervalSec * vp.sampleRate) / vp.samplesPerPx;
  if (barPx <= 0) return 1;
  return Math.max(1, Math.ceil(minLabelPx / barPx));
}

export interface MarkerTick { id: string; px: number; type: MarkerType; color: string }
export function visibleMarkerTicks(markers: Marker[], vp: Viewport): MarkerTick[] {
  const out: MarkerTick[] = [];
  for (const m of markers) {
    const px = secToPx(m.timeSec, vp);
    if (px >= -2 && px <= vp.widthPx + 2) out.push({ id: m.id, px, type: m.type, color: m.color });
  }
  return out;
}

export interface SilenceRegion { startSec: number; durSec: number }
export function silenceRegionsFromMarkers(markers: Marker[]): SilenceRegion[] {
  return markers
    .filter((m) => m.type === "silence" && m.id.endsWith("-in") && m.meta?.durationSec !== undefined)
    .map((m) => ({ startSec: m.timeSec, durSec: m.meta!.durationSec! }));
}

/** アンカー前フリー区間の終端(=先頭の非free拍時刻)。free拍が無ければ null。 */
export function freeZoneEndSec(grid: GridBeat[]): number | null {
  if (!grid.some((g) => g.free)) return null;
  const firstNonFree = grid.find((g) => !g.free);
  return firstNonFree ? firstNonFree.timeSec : null;
}

export type WaveHit =
  | { kind: "anchor" }
  | { kind: "sectionBoundary"; index: number }
  | { kind: "marker"; id: string }
  | { kind: "background" };

export interface WaveLayout {
  viewport: Viewport;
  heightPx: number;
  anchorSec: number | null;
  sectionBoundaries: { index: number; id: string; sec: number }[];
  markers: { id: string; sec: number; type: MarkerType }[];
}

const ANCHOR_HIT_PX = 6;
const FLAG_ZONE_PY = 14;
const BOUNDARY_HIT_PX = 5;
const MARKER_HIT_PX = 4;

export function hitTest(px: number, py: number, layout: WaveLayout): WaveHit {
  const vp = layout.viewport;
  if (layout.anchorSec !== null && py <= FLAG_ZONE_PY &&
      Math.abs(px - secToPx(layout.anchorSec, vp)) <= ANCHOR_HIT_PX) {
    return { kind: "anchor" };
  }
  if (py <= FLAG_ZONE_PY) {
    for (const b of layout.sectionBoundaries) {
      if (Math.abs(px - secToPx(b.sec, vp)) <= BOUNDARY_HIT_PX) return { kind: "sectionBoundary", index: b.index };
    }
  }
  let bestId: string | null = null;
  let bestD = MARKER_HIT_PX + 1;
  for (const m of layout.markers) {
    const d = Math.abs(px - secToPx(m.sec, vp));
    if (d <= MARKER_HIT_PX && d < bestD) { bestD = d; bestId = m.id; }
  }
  if (bestId !== null) return { kind: "marker", id: bestId };
  return { kind: "background" };
}

/** 描画に必要な最小限の2Dコンテキスト面(テストのフェイク差し替え用)。 */
export interface Ctx2D {
  save(): void; restore(): void;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  stroke(): void; fill(): void; fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
  setLineDash(d: number[]): void;
  strokeStyle: string; fillStyle: string; lineWidth: number; font: string; globalAlpha: number;
}

export interface PaintParams {
  layout: WaveLayout;
  peaks: PeakSet | null;
  grid: GridBeat[];
  markers: Marker[];
  playheadSec: number;
  colors?: { beat?: string; bar?: string; playhead?: string; anchor?: string; silence?: string };
}
export interface PaintStats {
  gridLines: number; barLabels: number; markerTicks: number; silenceRects: number;
  drewPlayhead: boolean; drewAnchor: boolean; drewFreeDim: boolean;
}

/** メイン波形を描画し、描いた要素数(検証用)を返す。 */
export function paintWave(ctx: Ctx2D, p: PaintParams): PaintStats {
  const vp = p.layout.viewport;
  const H = p.layout.heightPx;
  const W = vp.widthPx;
  const beatColor = p.colors?.beat ?? BEAT_COLOR;
  const barColor = p.colors?.bar ?? BAR_COLOR;
  const playheadColor = p.colors?.playhead ?? "#ff4d6b";
  const anchorColor = p.colors?.anchor ?? "#ffd166";
  const silenceColor = p.colors?.silence ?? "#6b7686";
  const mid = H / 2;

  ctx.clearRect(0, 0, W, H);

  // (d) 静寂リージョン(薄いハッチ代わりの半透明帯)
  const silences = silenceRegionsFromMarkers(p.markers);
  for (const r of silences) {
    const x = secToPx(r.startSec, vp);
    const w = (r.durSec * vp.sampleRate) / vp.samplesPerPx;
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = silenceColor;
    ctx.fillRect(x, 0, w, H);
    ctx.globalAlpha = 1;
  }

  // (f) フリー区間の減光(アンカー以前)
  const freeEnd = freeZoneEndSec(p.grid);
  let drewFreeDim = false;
  if (freeEnd !== null) {
    const x = secToPx(freeEnd, vp);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#0d0f13";
    ctx.fillRect(0, 0, Math.max(0, x), H);
    ctx.globalAlpha = 1;
    drewFreeDim = true;
  }

  // (a) ピーク(min/max 縦線)
  if (p.peaks && p.peaks.length > 0) {
    const level = pickLevel(p.peaks, vp.samplesPerPx);
    const bucketsPerPx = vp.samplesPerPx / level.samplesPerBucket;
    ctx.strokeStyle = "#9ecbff";
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    for (let px = 0; px < W; px++) {
      const sec = pxToSec(px, vp);
      const sampleIdx = sec * vp.sampleRate;
      const bucket = Math.floor(sampleIdx / level.samplesPerBucket);
      if (bucket < 0 || bucket >= level.min.length) continue;
      const lo = level.min[bucket]!;
      const hi = level.max[bucket]!;
      ctx.moveTo(px + 0.5, mid - hi * (mid - 8));
      ctx.lineTo(px + 0.5, mid - lo * (mid - 8));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    void bucketsPerPx;
  }

  // (b) 拍/小節グリッド + 小節番号
  const lines = visibleGridLines(p.grid, vp);
  const barStep = adaptiveBarStep(barLenSecOf(p.grid), vp);
  let barLabels = 0;
  ctx.font = "9px monospace";
  for (const l of lines) {
    if (l.free) continue;
    ctx.strokeStyle = l.isBar ? barColor : beatColor;
    ctx.lineWidth = l.isBar ? 1.4 : 1;
    ctx.globalAlpha = l.isBar ? 0.5 : 0.3;
    ctx.beginPath();
    ctx.moveTo(l.px + 0.5, l.isBar ? 14 : 22);
    ctx.lineTo(l.px + 0.5, H);
    ctx.stroke();
    if (l.isBar && l.barNumber > 0 && l.barNumber % barStep === 0) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#68738a";
      ctx.fillText(String(l.barNumber), l.px + 3, 3);
      barLabels++;
    }
  }
  ctx.globalAlpha = 1;

  // (g) マーカーティック(beat/bar はグリッド線・silence はリージョンで描くのでティックから除外)
  const ticks = visibleMarkerTicks(p.markers.filter((m) => m.type !== "beat" && m.type !== "bar" && m.type !== "silence"), vp);
  for (const t of ticks) {
    ctx.strokeStyle = t.color;
    ctx.lineWidth = t.type === "custom" ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(t.px + 0.5, 10);
    ctx.lineTo(t.px + 0.5, H);
    ctx.stroke();
  }

  // (e) アンカー旗
  let drewAnchor = false;
  if (p.layout.anchorSec !== null) {
    const x = secToPx(p.layout.anchorSec, vp);
    ctx.fillStyle = anchorColor;
    ctx.beginPath();
    ctx.moveTo(x, 10); ctx.lineTo(x - 5, 2); ctx.lineTo(x + 5, 2); ctx.fill();
    ctx.fillRect(x - 0.75, 10, 1.5, H - 10);
    drewAnchor = true;
  }

  // (c) プレイヘッド
  const phx = secToPx(p.playheadSec, vp);
  let drewPlayhead = false;
  if (phx >= 0 && phx <= W) {
    ctx.fillStyle = playheadColor;
    ctx.fillRect(phx - 1, 0, 2, H);
    drewPlayhead = true;
  }

  return {
    gridLines: lines.filter((l) => !l.free).length,
    barLabels, markerTicks: ticks.length, silenceRects: silences.length,
    drewPlayhead, drewAnchor, drewFreeDim,
  };
}

function barLenSecOf(grid: GridBeat[]): number {
  const bars = grid.filter((g) => g.isBar && !g.free);
  return bars.length >= 2 ? bars[1]!.timeSec - bars[0]!.timeSec : 2;
}
