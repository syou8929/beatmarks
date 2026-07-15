/** オーバービュー(スペック §7 ③): 全体波形(最粗レベル)・セクション色帯・表示窓ドラッグ・クリックジャンプ。
 *  モックの overview 相当。 */
import React, { useCallback, useEffect, useRef } from "react";

import { pickLevel, type PeakSet } from "../editor/peaks.js";
import { overviewSecToX, overviewWindowRect, overviewXToSec } from "../editor/overviewGeom.js";
import type { Viewport } from "../editor/waveGeom.js";
import { STRINGS } from "../strings.js";

const S = STRINGS.overview;

export interface OverviewSection { startSec: number; durationSec: number; color: string }

export interface OverviewProps {
  peaks: PeakSet | null;
  sections: OverviewSection[];
  durationSec: number;
  viewport: Viewport;
  playheadSec: number;
  onScrubTo: (sec: number) => void; // クリック/窓ドラッグ → 表示範囲移動+シーク(呼び出し側で配線)
}

export function Overview(props: OverviewProps): React.JSX.Element {
  const { peaks, sections, durationSec, viewport, playheadSec } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    const W = Math.max(1, rect.width);
    const H = Math.max(1, rect.height);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d") as (CanvasRenderingContext2D & { strokeRect: (x: number, y: number, w: number, h: number) => void }) | null;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // セクション色帯(背景 + 上部4pxの濃色)
    for (const s of sections) {
      const x = overviewSecToX(s.startSec, W, durationSec);
      const w = overviewSecToX(s.durationSec, W, durationSec);
      ctx.globalAlpha = 0.15; ctx.fillStyle = s.color; ctx.fillRect(x, 0, w, H);
      ctx.globalAlpha = 1; ctx.fillStyle = s.color; ctx.fillRect(x, 0, w, 4);
    }

    // 全体波形(最粗レベル)
    if (peaks && peaks.length > 0) {
      const level = peaks.levels[peaks.levels.length - 1] ?? pickLevel(peaks, Infinity);
      ctx.strokeStyle = "#aeb8c9"; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.beginPath();
      for (let px = 0; px < W; px++) {
        const sec = overviewXToSec(px, W, durationSec);
        const bucket = Math.floor((sec * peaks.sampleRate) / level.samplesPerBucket);
        if (bucket < 0 || bucket >= level.max.length) continue;
        const a = Math.max(Math.abs(level.min[bucket]!), Math.abs(level.max[bucket]!)) * (H / 2 - 6);
        ctx.moveTo(px + 0.5, H / 2 - a); ctx.lineTo(px + 0.5, H / 2 + a);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }

    // 表示窓
    const win = overviewWindowRect(durationSec, viewport, W);
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5;
    ctx.strokeRect(win.x + 0.5, 1, win.w, H - 2);

    // 再生ヘッド
    const phx = overviewSecToX(playheadSec, W, durationSec);
    ctx.fillStyle = "#ff4d6b"; ctx.fillRect(phx - 0.75, 0, 1.5, H);
  }, [peaks, sections, durationSec, viewport, playheadSec]);

  useEffect(() => { draw(); }, [draw]);

  function scrubAtClientX(clientX: number): void {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const sec = overviewXToSec(clientX - rect.left, rect.width, durationSec);
    props.onScrubTo(sec);
  }

  // クリックジャンプ+表示窓ドラッグ: pointerdown で即座に1回スクラブし(クリックジャンプ)、
  // 押している間は window の pointermove を追跡して継続的にスクラブする(表示窓ドラッグ)。
  // SectionBand.handleDrag と同じ window リスナー方式(このコンポーネントは canvas 全体が
  // ヒットエリアなので setPointerCapture は不要 — WaveCanvas 方式と違い hit-test の絞り込みがない)。
  function onPointerDown(e: React.PointerEvent): void {
    scrubAtClientX(e.clientX);
    const move = (ev: PointerEvent) => scrubAtClientX(ev.clientX);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div style={{ position: "relative", background: "#14171c", borderBottom: "1px solid #262c36", padding: "6px 14px 4px" }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        title={S.hint}
        style={{ width: "100%", height: 44, display: "block", borderRadius: 4, cursor: "pointer" }}
      />
    </div>
  );
}
