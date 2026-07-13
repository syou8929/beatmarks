import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPlayback } from "../audio/playback.js";

interface FakeNode {
  connect: (d?: unknown) => unknown;
  disconnect: () => void;
  start: (...a: number[]) => void;
  stop: (...a: number[]) => void;
  onended: (() => void) | null;
  buffer?: unknown;
  frequency?: { value: number };
  gain?: { setValueAtTime: (...a: number[]) => void; exponentialRampToValueAtTime: (...a: number[]) => void };
}
function node(extra: Partial<FakeNode> = {}): FakeNode {
  return { connect: vi.fn((d?: unknown) => d), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null, ...extra };
}

function fakeCtx(opts: { state?: string } = {}) {
  const oscillators: FakeNode[] = [];
  const buffers: FakeNode[] = [];
  const raw = {
    currentTime: 0,
    state: opts.state ?? "running",
    destination: {},
    resume: vi.fn(async () => { raw.state = "running"; }),
    decodeAudioData: vi.fn(async () => ({ duration: 10 }) as unknown as AudioBuffer),
    createBufferSource: vi.fn(() => { const n = node(); buffers.push(n); return n; }),
    createOscillator: vi.fn(() => { const n = node({ frequency: { value: 0 } }); oscillators.push(n); return n; }),
    createGain: vi.fn(() => node({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } })),
    close: vi.fn(async () => {}),
  };
  return { raw, oscillators, buffers };
}

describe("playback 拡張", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("play() は ctx が suspended なら resume() する", async () => {
    const { raw } = fakeCtx({ state: "suspended" });
    const pb = createPlayback(() => raw as unknown as AudioContext);
    await pb.load(new ArrayBuffer(8));
    pb.play();
    expect(raw.resume).toHaveBeenCalledTimes(1);
    pb.dispose();
  });

  it("seek 時に予約済みメトロノームクリックの osc を停止する", async () => {
    const f = fakeCtx();
    const pb = createPlayback(() => f.raw as unknown as AudioContext);
    await pb.load(new ArrayBuffer(8));
    pb.updateGrid([{ timeSec: 0.15, isBar: true }, { timeSec: 0.2, isBar: false }]);
    pb.setMetronome(true);
    pb.play(0);
    // pump を1回進めてクリックを予約(0..0.3s窓に2拍入る)
    f.raw.currentTime = 0.01;
    vi.advanceTimersByTime(100);
    expect(f.oscillators.length).toBeGreaterThan(0);
    const before = f.oscillators.map((o) => (o.disconnect as ReturnType<typeof vi.fn>).mock.calls.length);
    pb.seek(5); // ジャンプ → 予約済みクリックは無効化されるべき
    const after = f.oscillators.map((o) => (o.disconnect as ReturnType<typeof vi.fn>).mock.calls.length);
    expect(after.some((n, i) => n > before[i]!)).toBe(true);
    pb.dispose();
  });

  it("自然終了で onEnded コールバックが呼ばれる", async () => {
    const onEnded = vi.fn();
    const f = fakeCtx();
    const pb = createPlayback(() => f.raw as unknown as AudioContext, { onEnded });
    await pb.load(new ArrayBuffer(8));
    pb.play();
    const bufNode = f.buffers[f.buffers.length - 1]!;
    f.raw.currentTime = 20; // duration(10) 超過
    bufNode.onended?.();
    expect(onEnded).toHaveBeenCalledTimes(1);
    pb.dispose();
  });
});
