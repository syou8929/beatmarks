// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";

import { FPS_PRESETS } from "../../../shared/timebase.js";
import type { PlaybackEngine } from "../../audio/playback.js";
import { Transport } from "../../components/Transport.js";
import { ViewStoreProvider } from "../../state/viewStore.js";
import { STRINGS } from "../../strings.js";

function fakePlayback(over: Partial<PlaybackEngine> = {}): PlaybackEngine {
  return {
    load: vi.fn(async () => {}), play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(),
    currentTime: vi.fn(() => 42), isPlaying: vi.fn(() => false), durationSec: vi.fn(() => 210),
    setLoop: vi.fn(), setMetronome: vi.fn(), updateGrid: vi.fn(), dispose: vi.fn(), ...over,
  };
}

function renderTransport(
  pb: PlaybackEngine,
  cb: { onAddMarker?: (s: number) => void; onTapTempo?: (b: number) => void; isPlaying?: boolean } = {},
) {
  return render(
    <ViewStoreProvider>
      <Transport
        playback={pb} grid={[]} fps={FPS_PRESETS["30"]!} isPlaying={cb.isPlaying ?? false}
        onAddMarker={cb.onAddMarker ?? vi.fn()} onTapTempo={cb.onTapTempo ?? vi.fn()}
      />
    </ViewStoreProvider>,
  );
}

describe("Transport", () => {
  it("手動マーカーボタンで現在時刻を渡してコールバック", () => {
    const onAddMarker = vi.fn();
    const pb = fakePlayback({ currentTime: vi.fn(() => 42) });
    renderTransport(pb, { onAddMarker });
    fireEvent.click(screen.getByText(STRINGS.transport.addMarker));
    expect(onAddMarker).toHaveBeenCalledWith(42);
  });

  it("メトロノームトグルで playback.setMetronome(true) を呼ぶ", () => {
    const pb = fakePlayback();
    renderTransport(pb);
    fireEvent.click(screen.getByText(STRINGS.transport.metronome));
    expect(pb.setMetronome).toHaveBeenCalledWith(true);
  });

  // isPlaying は EditorScreen(親)が単一の情報源として渡す制御下プロパティ(T5レビュー契約・
  // WaveCanvasと同じパターン)。Transport 自身はもうローカルに再生状態を持たないため、
  // 「クリックでplay()を呼ぶ」ことと「isPlaying=trueのときpauseラベル+pause()を呼ぶ」ことを
  // それぞれ isPlaying を明示して検証する(以前のようなクリック起因の内部トグルは無い)。
  it("isPlaying=false のとき play ラベルを表示し、クリックで playback.play() を呼ぶ", () => {
    const pb = fakePlayback({ isPlaying: () => false });
    renderTransport(pb, { isPlaying: false });
    fireEvent.click(screen.getByText(STRINGS.transport.play));
    expect(pb.play).toHaveBeenCalled();
  });

  it("isPlaying=true のとき pause ラベルを表示し、クリックで playback.pause() を呼ぶ", () => {
    const pb = fakePlayback({ isPlaying: () => true });
    renderTransport(pb, { isPlaying: true });
    fireEvent.click(screen.getByText(STRINGS.transport.pause));
    expect(pb.pause).toHaveBeenCalled();
  });

  it("ループトグル: ON で setLoop(範囲)、再クリックで setLoop(null,null)", () => {
    const pb = fakePlayback({ currentTime: vi.fn(() => 10) });
    renderTransport(pb);
    const loopBtn = screen.getByText(STRINGS.transport.loop);
    fireEvent.click(loopBtn);
    expect(pb.setLoop).toHaveBeenLastCalledWith(10, expect.any(Number));
    fireEvent.click(loopBtn);
    expect(pb.setLoop).toHaveBeenLastCalledWith(null, null);
  });

  // T4への追加指示(台帳): タップテンポのコンポーネント配線RTLテスト(2秒リセット・onTapTempoガード)。
  describe("タップテンポ", () => {
    it("4回未満のタップでは onTapTempo を呼ばない(ガード)、4回目で呼ぶ", () => {
      const onTapTempo = vi.fn();
      const pb = fakePlayback();
      let t = 0;
      const perfSpy = vi.spyOn(performance, "now").mockImplementation(() => t);
      renderTransport(pb, { onTapTempo });
      const tapBtn = screen.getByText(STRINGS.transport.tapTempo);
      try {
        fireEvent.click(tapBtn); t = 500;
        fireEvent.click(tapBtn); t = 1000;
        fireEvent.click(tapBtn); t = 1500;
        expect(onTapTempo).not.toHaveBeenCalled();
        fireEvent.click(tapBtn);
        expect(onTapTempo).toHaveBeenCalledTimes(1);
        expect(onTapTempo.mock.calls[0]![0]).toBeCloseTo(120, 0); // 500ms間隔 = 120BPM
      } finally {
        perfSpy.mockRestore();
      }
    });

    it("直前のタップから2秒以上空くとタップ系列がリセットされる(4回目でも呼ばれない)", () => {
      const onTapTempo = vi.fn();
      const pb = fakePlayback();
      let t = 0;
      const perfSpy = vi.spyOn(performance, "now").mockImplementation(() => t);
      renderTransport(pb, { onTapTempo });
      const tapBtn = screen.getByText(STRINGS.transport.tapTempo);
      try {
        fireEvent.click(tapBtn); t = 500;
        fireEvent.click(tapBtn); t = 1000;
        fireEvent.click(tapBtn); // ここで3タップ目(まだ4未満なので発火しない)
        t = 3500; // 直前(1000)から2.5秒空ける(>2000ms)
        fireEvent.click(tapBtn); // リセットされていれば「リセット後1タップ目」のはず
        // リセットが効いていなければここは4タップ目になり onTapTempo が呼ばれてしまう。
        // 呼ばれていないことがリセットの証拠。
        expect(onTapTempo).not.toHaveBeenCalled();
      } finally {
        perfSpy.mockRestore();
      }
    });
  });
});
