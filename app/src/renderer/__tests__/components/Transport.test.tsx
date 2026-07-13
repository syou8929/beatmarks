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

function renderTransport(pb: PlaybackEngine, cb: { onAddMarker?: (s: number) => void; onTapTempo?: (b: number) => void } = {}) {
  return render(
    <ViewStoreProvider>
      <Transport
        playback={pb} grid={[]} fps={FPS_PRESETS["30"]!}
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

  it("再生ボタンで play()、再クリックで pause()", () => {
    let flag = false;
    const pb = fakePlayback({ play: vi.fn(() => { flag = true; }), pause: vi.fn(() => { flag = false; }), isPlaying: vi.fn(() => flag) });
    renderTransport(pb);
    fireEvent.click(screen.getByText(STRINGS.transport.play));
    expect(pb.play).toHaveBeenCalled();
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
});
