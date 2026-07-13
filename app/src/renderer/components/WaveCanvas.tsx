/** メイン波形(スペック §7 ⑤): ピーク/グリッド/プレイヘッド/静寂/アンカー旗/減光/マーカー。
 *  ロジックは waveGeom に寄せ、ここは canvas サイズ管理・rAF・ポインタ操作の薄い層。 */
import React, { useCallback, useEffect, useRef } from "react";

import type { GridBeat } from "../../shared/deriveGrid.js";
import type { Marker } from "../../shared/types.js";
import type { PlaybackEngine } from "../audio/playback.js";
import { snapSec } from "../editor/snap.js";
import { useViewStore } from "../state/viewStore.js";
import {
  hitTest, paintWave, pxToSec, zoomAt,
  type Ctx2D, type Viewport, type WaveLayout,
} from "../editor/waveGeom.js";

export interface WaveCanvasProps {
  peaks: import("../editor/peaks.js").PeakSet | null;
  grid: GridBeat[];
  markers: Marker[];
  anchorSec: number | null;
  playback: PlaybackEngine;
  sampleRate: number;
  /** 再生中か(rAFプレイヘッドループの起動制御用)。playback は同一参照のまま内部で
   *  再生状態が変わるため、React に再描画ループの開始/停止を伝えるにはこの reactive な
   *  prop が要る(playback.isPlaying() だけでは effect の依存に乗らず起動しない)。 */
  isPlaying: boolean;
  onSelectMarker: (id: string) => void;
  onAnchorDrag: (sec: number) => void;
}

export function WaveCanvas(props: WaveCanvasProps): React.JSX.Element {
  const { playback, grid, markers, anchorSec, sampleRate, isPlaying } = props;
  const { view, dispatch } = useViewStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingAnchor = useRef(false);

  const viewport = useCallback((widthPx: number): Viewport => ({
    scrollSec: view.scrollSec, samplesPerPx: view.zoomSamplesPerPx, sampleRate, widthPx,
  }), [view.scrollSec, view.zoomSamplesPerPx, sampleRate]);

  const layout = useCallback((widthPx: number, heightPx: number): WaveLayout => ({
    viewport: viewport(widthPx), heightPx, anchorSec,
    sectionBoundaries: markers
      .filter((m) => m.type === "section" && /^sec-o\d+$/.test(m.id))
      .map((m) => ({ index: parseInt(m.id.slice(5), 10), id: m.id, sec: m.timeSec })),
    markers: markers.map((m) => ({ id: m.id, sec: m.timeSec, type: m.type })),
  }), [viewport, anchorSec, markers]);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const raw = cv.getContext("2d");
    if (!raw) return;
    const ctx = raw as unknown as Ctx2D & { setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintWave(ctx, {
      layout: layout(w, h), peaks: props.peaks, grid, markers, playheadSec: playback.currentTime(),
    });
  }, [layout, props.peaks, grid, markers, playback]);

  // 表示状態・データ変更時に再描画
  useEffect(() => { draw(); }, [draw]);

  // 再生中のみ rAF でプレイヘッド更新(停止中は静止)。
  // isPlaying を依存に含めることで、再生開始/停止の切り替え時に必ずこの effect が
  // 再実行される(playback は同一オブジェクト参照のままなので、それだけでは起動しない)。
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (playback.isPlaying()) { draw(); raf = requestAnimationFrame(loop); }
    };
    if (isPlaying) raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw, playback, isPlaying]);

  function localPos(e: React.PointerEvent): { x: number; y: number; w: number } {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width };
  }

  // ホイール/トラックパッドのズーム・スクロール(スペック §7「ホイール/ピンチでカーソル中心ズーム」)。
  // React 19 は JSX の onWheel を passive リスナーとして登録するため、そこで e.preventDefault() を
  // 呼んでもページスクロールを止められない。ここでは canvas に直接 addEventListener し、
  // { passive: false } を明示して確実に preventDefault を効かせる。
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const handleWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const vp = viewport(rect.width);
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // 横優勢(2本指の水平スワイプ等) → 横スクロール
        const dSec = (e.deltaX * vp.samplesPerPx) / vp.sampleRate;
        dispatch({ type: "SET_VIEW", scrollSec: Math.max(0, vp.scrollSec + dSec) });
        return;
      }
      // 縦優勢 → カーソル中心ズーム(通常ホイールとピンチ[ctrl/meta+wheel]の両方)。
      // ピンチは trackpad が連続値を送るため指数カーブ、ホイールは notch 単位の固定比率。
      const anchorPx = e.clientX - rect.left;
      const factor = e.ctrlKey || e.metaKey
        ? Math.exp(-e.deltaY * 0.01)
        : e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const z = zoomAt(vp, factor, anchorPx);
      dispatch({ type: "SET_VIEW", scrollSec: Math.max(0, z.scrollSec), zoomSamplesPerPx: z.samplesPerPx });
    };
    cv.addEventListener("wheel", handleWheel, { passive: false });
    return () => cv.removeEventListener("wheel", handleWheel);
  }, [viewport, dispatch]);

  const dragState = useRef<{ startX: number; startScroll: number } | null>(null);

  function onPointerDown(e: React.PointerEvent): void {
    const { x, y, w } = localPos(e);
    const cv = canvasRef.current!;
    const lay = layout(w, cv.getBoundingClientRect().height);
    const hit = hitTest(x, y, lay);
    cv.setPointerCapture(e.pointerId);
    if (hit.kind === "anchor") { draggingAnchor.current = true; return; }
    if (hit.kind === "marker") { props.onSelectMarker(hit.id); return; }
    if (hit.kind === "sectionBoundary") {
      const b = lay.sectionBoundaries.find((s) => s.index === hit.index);
      if (b) props.onSelectMarker(b.id);
      return;
    }
    dragState.current = { startX: x, startScroll: view.scrollSec };
  }

  function onPointerMove(e: React.PointerEvent): void {
    const { x, w } = localPos(e);
    const vp = viewport(w);
    if (draggingAnchor.current) {
      const raw = pxToSec(x, vp);
      const snap = e.ctrlKey || e.metaKey ? raw : snapSec(raw, view.snapMode, { fps: { num: 30, den: 1 }, grid });
      props.onAnchorDrag(snap);
      return;
    }
    if (dragState.current) {
      const dSec = ((dragState.current.startX - x) * vp.samplesPerPx) / vp.sampleRate;
      dispatch({ type: "SET_VIEW", scrollSec: Math.max(0, dragState.current.startScroll + dSec) });
    }
  }

  function onPointerUp(e: React.PointerEvent): void {
    draggingAnchor.current = false;
    dragState.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
