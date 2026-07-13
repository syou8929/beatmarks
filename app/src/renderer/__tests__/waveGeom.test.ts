import { describe, expect, it } from "vitest";

import { deriveGrid } from "../../shared/deriveGrid.js";
import type { AnalysisResult, Marker } from "../../shared/types.js";
import { defaultEditState } from "../../shared/validate.js";
import {
  adaptiveBarStep, freeZoneEndSec, hitTest, MAX_SAMPLES_PER_PX, MIN_SAMPLES_PER_PX, pxToSec, secToPx,
  silenceRegionsFromMarkers, visibleGridLines, visibleRange, zoomAt,
  type Viewport, type WaveLayout,
} from "../editor/waveGeom.js";

const VP: Viewport = { scrollSec: 10, samplesPerPx: 441, sampleRate: 44100, widthPx: 1000 };
// samplesPerPx/sampleRate = 0.01 s/px → 1000px = 10s 表示

describe("座標変換", () => {
  it("secToPx / pxToSec は逆変換", () => {
    expect(secToPx(10, VP)).toBeCloseTo(0, 6);
    expect(secToPx(20, VP)).toBeCloseTo(1000, 6);
    expect(pxToSec(0, VP)).toBeCloseTo(10, 6);
    expect(pxToSec(500, VP)).toBeCloseTo(15, 6);
    expect(pxToSec(secToPx(13.7, VP), VP)).toBeCloseTo(13.7, 6);
  });
  it("visibleRange は左端〜右端の秒", () => {
    const r = visibleRange(VP);
    expect(r.fromSec).toBeCloseTo(10, 6);
    expect(r.toSec).toBeCloseTo(20, 6);
  });
});

describe("zoomAt(カーソル中心)", () => {
  it("ズームインしてもアンカー px の時刻は不変", () => {
    const anchorPx = 300;
    const before = pxToSec(anchorPx, VP);
    const z = zoomAt(VP, 2, anchorPx); // factor2 = 拡大
    expect(z.samplesPerPx).toBeCloseTo(220.5, 6);
    expect(pxToSec(anchorPx, z)).toBeCloseTo(before, 6);
  });
  it("ズームアウトでもアンカー px の時刻は不変", () => {
    const anchorPx = 700;
    const before = pxToSec(anchorPx, VP);
    const z = zoomAt(VP, 0.5, anchorPx);
    expect(z.samplesPerPx).toBeCloseTo(882, 6);
    expect(pxToSec(anchorPx, z)).toBeCloseTo(before, 6);
  });
});

describe("zoomAt: samplesPerPx クランプ(暴走ズーム対策)", () => {
  it("過剰ズームイン(巨大factor)は MIN_SAMPLES_PER_PX でクランプされ、NaN/Infinity にならない", () => {
    const z = zoomAt(VP, 1e12, 300);
    expect(z.samplesPerPx).toBe(MIN_SAMPLES_PER_PX);
    expect(Number.isFinite(z.samplesPerPx)).toBe(true);
    expect(Number.isFinite(z.scrollSec)).toBe(true);
  });
  it("過剰ズームアウト(極小factor)は MAX_SAMPLES_PER_PX でクランプされ、NaN/Infinity にならない", () => {
    const z = zoomAt(VP, 1e-9, 300);
    expect(z.samplesPerPx).toBe(MAX_SAMPLES_PER_PX);
    expect(Number.isFinite(z.samplesPerPx)).toBe(true);
    expect(Number.isFinite(z.scrollSec)).toBe(true);
  });
  it("クランプが効いてもアンカー px の時刻は不変(クランプ後の値から scrollSec を再計算するため)", () => {
    const anchorPx = 300;
    const before = pxToSec(anchorPx, VP);
    const zIn = zoomAt(VP, 1e12, anchorPx);
    const zOut = zoomAt(VP, 1e-9, anchorPx);
    expect(pxToSec(anchorPx, zIn)).toBeCloseTo(before, 6);
    expect(pxToSec(anchorPx, zOut)).toBeCloseTo(before, 6);
  });
  it("fuzz: 疑似乱数200件で samplesPerPx は常にクランプ範囲内、アンカー不変", () => {
    let seed = 42;
    const rand = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 200; i++) {
      const vp: Viewport = { scrollSec: rand() * 100, samplesPerPx: 1 + rand() * 2000, sampleRate: 44100, widthPx: 1000 };
      const anchorPx = rand() * vp.widthPx;
      const factor = 0.01 + rand() * 100;
      const before = pxToSec(anchorPx, vp);
      const z = zoomAt(vp, factor, anchorPx);
      expect(z.samplesPerPx).toBeGreaterThanOrEqual(MIN_SAMPLES_PER_PX);
      expect(z.samplesPerPx).toBeLessThanOrEqual(MAX_SAMPLES_PER_PX);
      expect(pxToSec(anchorPx, z)).toBeCloseTo(before, 6);
    }
  });
});

function gridCtx() {
  const a: AnalysisResult = {
    durationSec: 40, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0,
    beats: Array.from({ length: 80 }, (_, i) => i * 0.5), downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [], hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
  };
  return deriveGrid(a, defaultEditState());
}

describe("可視要素抽出", () => {
  it("visibleGridLines は表示範囲(10..20s, 0.5s間隔)の拍のみ", () => {
    const lines = visibleGridLines(gridCtx(), VP);
    // 10.0,10.5,...,20.0 → 21本(両端含む)
    expect(lines.length).toBe(21);
    expect(lines.every((l) => l.px >= -1 && l.px <= VP.widthPx + 1)).toBe(true);
    expect(lines.filter((l) => l.isBar).length).toBeGreaterThan(0);
  });
  it("adaptiveBarStep は小節間隔が狭いほど間引く", () => {
    // 小節=2s → 2s*100px/s=200px間隔 → step1
    expect(adaptiveBarStep(2, VP, 60)).toBe(1);
    // 表示を大きく縮小(1px=1s相当)すると 2s=2px間隔 → step ceil(60/2)=30
    const wide: Viewport = { ...VP, samplesPerPx: 44100 };
    expect(adaptiveBarStep(2, wide, 60)).toBe(30);
  });
  it("silenceRegionsFromMarkers は sil-*-in を duration 付きリージョン化", () => {
    const markers: Marker[] = [
      { id: "sil-0-in", sourceId: "mix", timeSec: 5, type: "silence", label: "静寂IN", color: "#6b7686", source: "auto", meta: { durationSec: 1.5 } },
      { id: "sil-0-out", sourceId: "mix", timeSec: 6.5, type: "silence", label: "静寂OUT", color: "#6b7686", source: "auto" },
    ];
    expect(silenceRegionsFromMarkers(markers)).toEqual([{ startSec: 5, durSec: 1.5 }]);
  });
  it("freeZoneEndSec: free拍が無ければ null、あれば先頭の非free拍時刻", () => {
    expect(freeZoneEndSec(gridCtx())).toBeNull();
    const withFree = gridCtx().map((g, i) => (i < 3 ? { ...g, free: true } : g));
    expect(freeZoneEndSec(withFree)).toBeCloseTo(withFree[3]!.timeSec, 6);
  });
});

describe("hitTest 優先度", () => {
  const layout: WaveLayout = {
    viewport: VP, heightPx: 200, anchorSec: 12,
    sectionBoundaries: [{ index: 1, id: "sec-o1", sec: 15 }],
    markers: [{ id: "hit-low-3", sec: 18, type: "hit" }],
  };
  it("アンカー旗(上部)を最優先", () => {
    expect(hitTest(secToPx(12, VP), 5, layout)).toEqual({ kind: "anchor" });
  });
  it("セクション境界(上部ハンドル)", () => {
    expect(hitTest(secToPx(15, VP), 5, layout)).toEqual({ kind: "sectionBoundary", index: 1 });
  });
  it("マーカーティック", () => {
    expect(hitTest(secToPx(18, VP), 120, layout)).toEqual({ kind: "marker", id: "hit-low-3" });
  });
  it("何もない所は background", () => {
    expect(hitTest(secToPx(13, VP), 120, layout)).toEqual({ kind: "background" });
  });
});

describe("hitTest: 近接マーカーは最近傍が決定的に勝つ", () => {
  // 2px 離れた2マーカー。クリック位置をどちらかへ僅かに寄せ、常に「近い方」が勝つことを
  // 配列順とは無関係に確認する(先勝ち/後勝ちの偶然一致ではないことの証明)。
  const markerA = { id: "m-a", sec: pxToSec(800, VP), type: "hit" as const };
  const markerB = { id: "m-b", sec: pxToSec(802, VP), type: "hit" as const };
  const layout: WaveLayout = {
    viewport: VP, heightPx: 200, anchorSec: null, sectionBoundaries: [],
    markers: [markerA, markerB],
  };
  it("Aに近いクリックはAが勝つ", () => {
    expect(hitTest(800.4, 120, layout)).toEqual({ kind: "marker", id: "m-a" });
  });
  it("Bに近いクリックはBが勝つ(配列順は不変、勝者だけ変わる)", () => {
    expect(hitTest(801.6, 120, layout)).toEqual({ kind: "marker", id: "m-b" });
  });
});
