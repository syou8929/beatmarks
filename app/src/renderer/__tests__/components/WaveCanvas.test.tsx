// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";

import { deriveGrid } from "../../../shared/deriveGrid.js";
import type { AnalysisResult, Marker } from "../../../shared/types.js";
import { defaultEditState } from "../../../shared/validate.js";
import type { PlaybackEngine } from "../../audio/playback.js";
import { WaveCanvas } from "../../components/WaveCanvas.js";
import { paintWave, type Ctx2D, type WaveLayout, type Viewport } from "../../editor/waveGeom.js";
import { ViewStoreProvider } from "../../state/viewStore.js";

function recordingCtx(): Ctx2D & { calls: Record<string, number>; setTransform: () => void } {
  const calls: Record<string, number> = {};
  const bump = (k: string) => { calls[k] = (calls[k] ?? 0) + 1; };
  return {
    calls,
    save: () => bump("save"), restore: () => bump("restore"),
    beginPath: () => bump("beginPath"), moveTo: () => bump("moveTo"), lineTo: () => bump("lineTo"),
    stroke: () => bump("stroke"), fill: () => bump("fill"),
    fillRect: () => bump("fillRect"), clearRect: () => bump("clearRect"),
    fillText: () => bump("fillText"), setLineDash: () => bump("setLineDash"),
    setTransform: () => bump("setTransform"), // WaveCanvas が dpr スケールで呼ぶ
    strokeStyle: "", fillStyle: "", lineWidth: 1, font: "", globalAlpha: 1,
  };
}

const VP: Viewport = { scrollSec: 0, samplesPerPx: 441, sampleRate: 44100, widthPx: 1000 };
function grid() {
  const a: AnalysisResult = {
    durationSec: 12, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0,
    beats: Array.from({ length: 24 }, (_, i) => i * 0.5), downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [], hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
  };
  return deriveGrid(a, defaultEditState());
}

describe("paintWave(フェイク2Dコンテキスト)", () => {
  it("描いたグリッド線数が可視拍数に一致し、プレイヘッドを描く", () => {
    const g = grid();
    const layout: WaveLayout = { viewport: VP, heightPx: 200, anchorSec: null, sectionBoundaries: [], markers: [] };
    const ctx = recordingCtx();
    const stats = paintWave(ctx, { layout, peaks: null, grid: g, markers: [], playheadSec: 1 });
    // 0..10s 表示に 0.5s間隔 → 21拍
    expect(stats.gridLines).toBe(21);
    expect(stats.drewPlayhead).toBe(true);
    expect(ctx.calls["stroke"]).toBeGreaterThan(0);
  });

  it("静寂リージョンと手動マーカーを描画件数に反映", () => {
    const markers: Marker[] = [
      { id: "sil-0-in", sourceId: "mix", timeSec: 2, type: "silence", label: "静寂IN", color: "#6b7686", source: "auto", meta: { durationSec: 1 } },
      { id: "custom-1", sourceId: "mix", timeSec: 3, type: "custom", label: "M", color: "#ffd166", source: "user" },
    ];
    const layout: WaveLayout = { viewport: VP, heightPx: 200, anchorSec: null, sectionBoundaries: [], markers: [] };
    const stats = paintWave(recordingCtx(), { layout, peaks: null, grid: grid(), markers, playheadSec: 1 });
    expect(stats.silenceRects).toBe(1);
    expect(stats.markerTicks).toBe(1); // beat/bar 除外、custom のみ
  });
});

describe("WaveCanvas マウント", () => {
  it("canvas を描画し 2D コンテキストを取得する", () => {
    const getContext = vi.fn(() => recordingCtx());
    // jsdom は getContext=null なのでスタブ差し替え
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = getContext as unknown as typeof orig;
    const pb: PlaybackEngine = {
      load: vi.fn(async () => {}), play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(),
      currentTime: vi.fn(() => 0), isPlaying: vi.fn(() => false), durationSec: vi.fn(() => 12),
      setLoop: vi.fn(), setMetronome: vi.fn(), updateGrid: vi.fn(), dispose: vi.fn(),
    };
    const { container } = render(
      <ViewStoreProvider>
        <WaveCanvas
          peaks={null} grid={grid()} markers={[]} anchorSec={null} playback={pb}
          sampleRate={44100} onSelectMarker={vi.fn()} onAnchorDrag={vi.fn()}
        />
      </ViewStoreProvider>,
    );
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(getContext).toHaveBeenCalled();
    HTMLCanvasElement.prototype.getContext = orig;
  });
});
