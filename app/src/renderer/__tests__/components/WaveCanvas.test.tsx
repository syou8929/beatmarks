// @vitest-environment jsdom
import { createEvent, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";

import { deriveGrid } from "../../../shared/deriveGrid.js";
import type { GridBeat } from "../../../shared/deriveGrid.js";
import type { AnalysisResult, Marker } from "../../../shared/types.js";
import { defaultEditState } from "../../../shared/validate.js";
import type { PlaybackEngine } from "../../audio/playback.js";
import { WaveCanvas } from "../../components/WaveCanvas.js";
import type { PeakLevel, PeakSet } from "../../editor/peaks.js";
import { paintWave, type Ctx2D, type WaveLayout, type Viewport } from "../../editor/waveGeom.js";
import { useViewStore, ViewStoreProvider } from "../../state/viewStore.js";

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
          sampleRate={44100} isPlaying={false} onSelectMarker={vi.fn()} onAnchorDrag={vi.fn()}
        />
      </ViewStoreProvider>,
    );
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(getContext).toHaveBeenCalled();
    HTMLCanvasElement.prototype.getContext = orig;
  });
});

function plantedTransientPeaks(): PeakSet {
  const spb = 100;
  const bucketCount = 100;
  const min = new Float32Array(bucketCount).fill(-0.05);
  const max = new Float32Array(bucketCount).fill(0.05);
  min[21] = -0.9; // トランジェント(旧実装は px=5 列で bucket20 のみ見るため見逃す)
  max[21] = 0.95;
  const level: PeakLevel = { samplesPerBucket: spb, min, max };
  return { durationSec: (bucketCount * spb) / 44100, sampleRate: 44100, length: bucketCount * spb, levels: [level] };
}

function coordCtx(): { ctx: Ctx2D; moveTo: Array<[number, number]>; lineTo: Array<[number, number]> } {
  const moveTo: Array<[number, number]> = [];
  const lineTo: Array<[number, number]> = [];
  const ctx: Ctx2D = {
    save: () => {}, restore: () => {}, beginPath: () => {},
    moveTo: (x, y) => { moveTo.push([x, y]); },
    lineTo: (x, y) => { lineTo.push([x, y]); },
    stroke: () => {}, fill: () => {}, fillRect: () => {}, clearRect: () => {},
    fillText: () => {}, setLineDash: () => {},
    strokeStyle: "", fillStyle: "", lineWidth: 1, font: "", globalAlpha: 1,
  };
  return { ctx, moveTo, lineTo };
}

describe("paintWave: フラクショナルズームでのピーク集約(トランジェント欠落の修正)", () => {
  it("1px列が複数バケットに跨るとき、跨る全バケットのmin/maxを反映する(旧実装は先頭バケットのみで見逃す)", () => {
    const peaks = plantedTransientPeaks();
    // samplesPerPx=400=4×samplesPerBucket(100) → 1px が4バケットに跨るフラクショナルズーム
    const vp: Viewport = { scrollSec: 0, samplesPerPx: 400, sampleRate: 44100, widthPx: 20 };
    const layout: WaveLayout = { viewport: vp, heightPx: 200, anchorSec: null, sectionBoundaries: [], markers: [] };
    const { ctx, moveTo, lineTo } = coordCtx();
    paintWave(ctx, { layout, peaks, grid: [], markers: [], playheadSec: -1 });
    // px=5 列は sample 2000..2399 → bucket20..23 に跨る。トランジェントは bucket21。
    const mid = 100; // heightPx/2
    // Float32Array 格納時に丸められる値と比較するため Math.fround で期待値側も同じ精度に揃える
    const hi = Math.fround(0.95);
    const lo = Math.fround(-0.9);
    expect(moveTo).toHaveLength(20);
    expect(moveTo[5]![0]).toBeCloseTo(5.5, 6);
    expect(moveTo[5]![1]).toBeCloseTo(mid - hi * (mid - 8), 5); // hi=0.95(トランジェント込み)
    expect(lineTo[5]![1]).toBeCloseTo(mid - lo * (mid - 8), 5); // lo=-0.9(トランジェント込み)
  });

  it("バケット数を超えるpx列は範囲外ガードでスキップする(例外なし)", () => {
    const spb = 100;
    const min = new Float32Array(4).fill(-0.1);
    const max = new Float32Array(4).fill(0.1);
    const peaks: PeakSet = { durationSec: 400 / 44100, sampleRate: 44100, length: 400, levels: [{ samplesPerBucket: spb, min, max }] };
    // widthPx×samplesPerPx がバケット総量(4バケット×100=400サンプル)を大きく超える
    const vp: Viewport = { scrollSec: 0, samplesPerPx: 400, sampleRate: 44100, widthPx: 20 };
    const layout: WaveLayout = { viewport: vp, heightPx: 200, anchorSec: null, sectionBoundaries: [], markers: [] };
    expect(() => paintWave(coordCtx().ctx, { layout, peaks, grid: [], markers: [], playheadSec: -1 })).not.toThrow();
  });
});

function variableTempoGrid(): GridBeat[] {
  const earlyTimes = [0, 2, 4, 6, 8, 10]; // 2s間隔
  const lateTimes = [10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14]; // 0.5s間隔
  const out: GridBeat[] = [];
  earlyTimes.forEach((t, i) => out.push({ timeSec: t, index: i, isBar: true, barNumber: i + 1, free: false }));
  lateTimes.forEach((t, i) => out.push({
    timeSec: t, index: earlyTimes.length + i, isBar: true, barNumber: earlyTimes.length + i + 1, free: false,
  }));
  return out;
}

describe("paintWave: 可変テンポでの小節ラベル間引き(可視窓の密度を使う)", () => {
  it("前半(2s間隔)と後半(0.5s間隔)で間引きステップが異なる(旧実装は先頭2小節=2sを全域に誤用)", () => {
    const gridVar = variableTempoGrid();
    const vpEarly: Viewport = { scrollSec: 0, samplesPerPx: 4410, sampleRate: 44100, widthPx: 100 }; // 0..10s可視(前半のみ)
    const vpLate: Viewport = { scrollSec: 10.5, samplesPerPx: 4410, sampleRate: 44100, widthPx: 100 }; // 10.5..20.5s可視(後半のみ)
    const earlyLayout: WaveLayout = { viewport: vpEarly, heightPx: 200, anchorSec: null, sectionBoundaries: [], markers: [] };
    const lateLayout: WaveLayout = { viewport: vpLate, heightPx: 200, anchorSec: null, sectionBoundaries: [], markers: [] };
    const early = paintWave(recordingCtx(), { layout: earlyLayout, peaks: null, grid: gridVar, markers: [], playheadSec: -1 });
    const late = paintWave(recordingCtx(), { layout: lateLayout, peaks: null, grid: gridVar, markers: [], playheadSec: -1 });
    expect(early.barLabels).toBe(2); // interval2s → barPx20 → step ceil(60/20)=3 → barNumber 3,6
    expect(late.barLabels).toBe(1); // interval0.5s → barPx5 → step ceil(60/5)=12 → barNumber12のみ
    expect(late.barLabels).not.toBe(early.barLabels);
  });
});

describe("WaveCanvas: isPlaying による rAF プレイヘッドループの起動/停止", () => {
  function stubCanvasContext(): () => void {
    const getContext = vi.fn(() => recordingCtx());
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = getContext as unknown as typeof orig;
    return () => { HTMLCanvasElement.prototype.getContext = orig; };
  }

  it("isPlaying=true→rAF開始、false→cancel、再度true→開始、アンマウントでもcancel", () => {
    const restoreCtx = stubCanvasContext();
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(999);
    const cafSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      // grid/markers/playback を全レンダーで同一参照にする(isPlaying だけを変えて draw の
      // 参照安定性を保ち、rAF effect の再実行が isPlaying の変化だけに起因することを保証する)。
      const g = grid();
      const markersArr: Marker[] = [];
      const pb: PlaybackEngine = {
        load: vi.fn(async () => {}), play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(),
        currentTime: vi.fn(() => 0), isPlaying: vi.fn(() => false), durationSec: vi.fn(() => 12),
        setLoop: vi.fn(), setMetronome: vi.fn(), updateGrid: vi.fn(), dispose: vi.fn(),
      };
      const selectMock = vi.fn();
      const dragMock = vi.fn();
      const ui = (isPlaying: boolean): React.JSX.Element => (
        <ViewStoreProvider>
          <WaveCanvas
            peaks={null} grid={g} markers={markersArr} anchorSec={null} playback={pb}
            sampleRate={44100} isPlaying={isPlaying} onSelectMarker={selectMock} onAnchorDrag={dragMock}
          />
        </ViewStoreProvider>
      );

      const { rerender, unmount } = render(ui(false));
      expect(rafSpy).not.toHaveBeenCalled();

      rafSpy.mockClear();
      rerender(ui(true));
      expect(rafSpy).toHaveBeenCalled();

      cafSpy.mockClear();
      rerender(ui(false));
      expect(cafSpy).toHaveBeenCalledWith(999);

      rafSpy.mockClear();
      rerender(ui(true));
      expect(rafSpy).toHaveBeenCalled();

      cafSpy.mockClear();
      unmount();
      expect(cafSpy).toHaveBeenCalledWith(999);
    } finally {
      rafSpy.mockRestore();
      cafSpy.mockRestore();
      restoreCtx();
    }
  });
});

describe("WaveCanvas: ホイール(非passive・カーソル中心ズーム/ピンチ/横スクロール)", () => {
  function setup() {
    const getContext = vi.fn(() => recordingCtx());
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = getContext as unknown as typeof origGetContext;

    const pb: PlaybackEngine = {
      load: vi.fn(async () => {}), play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(),
      currentTime: vi.fn(() => 0), isPlaying: vi.fn(() => false), durationSec: vi.fn(() => 12),
      setLoop: vi.fn(), setMetronome: vi.fn(), updateGrid: vi.fn(), dispose: vi.fn(),
    };

    let store: ReturnType<typeof useViewStore> | null = null;
    function Probe(): React.JSX.Element | null {
      store = useViewStore();
      return null;
    }

    const { container, unmount } = render(
      <ViewStoreProvider>
        <Probe />
        <WaveCanvas
          peaks={null} grid={grid()} markers={[]} anchorSec={null} playback={pb}
          sampleRate={44100} isPlaying={false} onSelectMarker={vi.fn()} onAnchorDrag={vi.fn()}
        />
      </ViewStoreProvider>,
    );
    const canvas = container.querySelector("canvas")!;
    return {
      canvas,
      getView: () => store!.view,
      unmount,
      restore: () => { HTMLCanvasElement.prototype.getContext = origGetContext; },
    };
  }

  it("プレーンホイール(縦優勢・deltaY>0)はカーソル中心ズームイン(密度↓)し、preventDefaultされる", () => {
    const { canvas, getView, restore } = setup();
    try {
      const before = getView().zoomSamplesPerPx;
      const ev = createEvent.wheel(canvas, { deltaY: 100, deltaX: 0, cancelable: true, clientX: 500, clientY: 50 });
      fireEvent(canvas, ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(getView().zoomSamplesPerPx).toBeLessThan(before);
    } finally { restore(); }
  });

  it("プレーンホイール(deltaY<0)はズームアウト(密度↑)", () => {
    const { canvas, getView, restore } = setup();
    try {
      const before = getView().zoomSamplesPerPx;
      const ev = createEvent.wheel(canvas, { deltaY: -100, deltaX: 0, cancelable: true, clientX: 500, clientY: 50 });
      fireEvent(canvas, ev);
      expect(getView().zoomSamplesPerPx).toBeGreaterThan(before);
    } finally { restore(); }
  });

  it("ctrl+wheel(ピンチ相当・deltaY>0)は横スクロールでなくズームになる(旧実装はPANしていた)", () => {
    const { canvas, getView, restore } = setup();
    try {
      const beforeZoom = getView().zoomSamplesPerPx;
      const ev = createEvent.wheel(canvas, { deltaY: 100, deltaX: 0, ctrlKey: true, cancelable: true, clientX: 500, clientY: 50 });
      fireEvent(canvas, ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(getView().zoomSamplesPerPx).not.toBe(beforeZoom);
      expect(getView().zoomSamplesPerPx).toBeLessThan(beforeZoom); // deltaY>0 → factor=exp(1)>1 → ズームイン
    } finally { restore(); }
  });

  it("ctrl+wheel(deltaY<0)はズームアウト", () => {
    const { canvas, getView, restore } = setup();
    try {
      const beforeZoom = getView().zoomSamplesPerPx;
      const ev = createEvent.wheel(canvas, { deltaY: -100, deltaX: 0, ctrlKey: true, cancelable: true, clientX: 500, clientY: 50 });
      fireEvent(canvas, ev);
      expect(getView().zoomSamplesPerPx).toBeGreaterThan(beforeZoom);
    } finally { restore(); }
  });

  it("横優勢(|deltaX|>|deltaY|)は横スクロール、ズームは不変", () => {
    const { canvas, getView, restore } = setup();
    try {
      const beforeZoom = getView().zoomSamplesPerPx;
      const beforeScroll = getView().scrollSec;
      const ev = createEvent.wheel(canvas, { deltaX: 300, deltaY: 10, cancelable: true, clientX: 10, clientY: 10 });
      fireEvent(canvas, ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(getView().zoomSamplesPerPx).toBe(beforeZoom);
      expect(getView().scrollSec).toBeGreaterThan(beforeScroll);
    } finally { restore(); }
  });

  it("横スクロールは0未満にクランプされる", () => {
    const { canvas, getView, restore } = setup();
    try {
      const ev = createEvent.wheel(canvas, { deltaX: -300, deltaY: 10, cancelable: true, clientX: 10, clientY: 10 });
      fireEvent(canvas, ev);
      expect(getView().scrollSec).toBe(0);
    } finally { restore(); }
  });

  it("アンマウント後はネイティブリスナーが解除され、以後dispatchしても例外なし", () => {
    const { canvas, unmount, restore } = setup();
    try {
      const removeSpy = vi.spyOn(canvas, "removeEventListener");
      unmount();
      expect(removeSpy).toHaveBeenCalledWith("wheel", expect.any(Function));
      expect(() => {
        const ev = createEvent.wheel(canvas, { deltaY: 50, cancelable: true, clientX: 10, clientY: 10 });
        canvas.dispatchEvent(ev);
      }).not.toThrow();
    } finally { restore(); }
  });
});
