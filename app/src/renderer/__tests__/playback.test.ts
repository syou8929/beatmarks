import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clicksInWindow, createPlayback } from "../audio/playback.js";

const GRID = [
  { timeSec: 0.25, isBar: true },
  { timeSec: 0.75, isBar: false },
  { timeSec: 1.25, isBar: false },
  { timeSec: 1.75, isBar: false },
  { timeSec: 2.25, isBar: true },
];

describe("clicksInWindow", () => {
  it("[from, to)の拍だけを返す", () => {
    const c = clicksInWindow(GRID, 0.5, 1.8);
    expect(c.map((x) => x.timeSec)).toEqual([0.75, 1.25, 1.75]);
  });

  it("小節頭フラグが保たれる", () => {
    const c = clicksInWindow(GRID, 0, 3);
    expect(c.filter((x) => x.isBar).map((x) => x.timeSec)).toEqual([0.25, 2.25]);
  });

  it("境界: fromちょうどは含み、toちょうどは含まない", () => {
    expect(clicksInWindow(GRID, 0.25, 2.25).map((x) => x.timeSec))
      .toEqual([0.25, 0.75, 1.25, 1.75]);
  });

  it("空グリッド・逆転窓は空", () => {
    expect(clicksInWindow([], 0, 10)).toEqual([]);
    expect(clicksInWindow(GRID, 2, 1)).toEqual([]);
  });
});

// --- レビュー対応: createPlayback の状態機械テスト(コミット7481d71へのレビュー
// 指摘に対応)。実DOMのAudioContextは使わず、ctxFactoryに渡す最小限のフェイクで
// 検証する(connect/disconnect/start/stop/onendedを持つプレーンオブジェクト)。 ---

interface FakeAudioNode {
  connect: (dest?: unknown) => unknown;
  disconnect: () => void;
  start: (...args: number[]) => void;
  stop: (...args: number[]) => void;
  onended: (() => void) | null;
  buffer?: unknown;
  frequency?: { value: number };
  gain?: {
    setValueAtTime: (...args: number[]) => void;
    exponentialRampToValueAtTime: (...args: number[]) => void;
  };
}

function makeNode(extra: Partial<FakeAudioNode> = {}): FakeAudioNode {
  return {
    connect: vi.fn((dest?: unknown) => dest),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
    ...extra,
  };
}

/** ctxFactory に渡すフェイクAudioContext。currentTimeは手動で書き換え可能な数値
 *  プロパティにし、テスト側でvi.advanceTimersByTimeと歩調を合わせて進める。 */
function createFakeCtx(opts: {
  duration?: number;
  decodeAudioData?: () => Promise<AudioBuffer>;
} = {}) {
  const duration = opts.duration ?? 4;
  const bufferNodes: FakeAudioNode[] = [];
  const raw = {
    currentTime: 0,
    destination: {},
    decodeAudioData: vi.fn(
      opts.decodeAudioData ?? (async () => ({ duration }) as unknown as AudioBuffer),
    ),
    createBufferSource: vi.fn(() => {
      const n = makeNode();
      bufferNodes.push(n);
      return n;
    }),
    createOscillator: vi.fn(() => makeNode({ frequency: { value: 0 } })),
    createGain: vi.fn(() => makeNode({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    })),
    close: vi.fn(async () => {}),
  };
  return { fakeCtx: raw as unknown as AudioContext, raw, bufferNodes };
}

/** フェイクctxでロード済みのPlaybackEngineを作る */
async function loadedPlayback(duration = 4) {
  const { fakeCtx, raw, bufferNodes } = createFakeCtx({ duration });
  const factory = vi.fn(() => fakeCtx);
  const pb = createPlayback(factory);
  await pb.load(new ArrayBuffer(8));
  return { pb, raw, bufferNodes, factory };
}

describe("createPlayback(状態機械, フェイクAudioContext)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ctx時計が大きく進んでもcurrentTime()はdurationでクランプされ、onended発火でplayingがfalseになる", async () => {
    const { pb, raw, bufferNodes } = await loadedPlayback(4);
    pb.play();
    const node = bufferNodes[bufferNodes.length - 1]!;

    raw.currentTime = 100; // durationを大幅に超えて経過させる
    expect(pb.currentTime()).toBe(4);
    expect(pb.isPlaying()).toBe(true); // onended未発火の間はまだplaying扱い

    node.onended?.(); // ブラウザがバッファ終端で発火させるのを模擬
    expect(pb.isPlaying()).toBe(false);

    pb.dispose();
  });

  it("自然終了後にplay()を呼ぶと先頭(0秒)から再生し直す(無音のゼロ長再生を防ぐ)", async () => {
    const { pb, raw, bufferNodes } = await loadedPlayback(4);
    pb.play();
    const firstNode = bufferNodes[bufferNodes.length - 1]!;
    raw.currentTime = 10; // durationを超えて自然終了させる
    firstNode.onended?.();
    expect(pb.isPlaying()).toBe(false);

    pb.play(); // fromSecなしで再生再開
    expect(pb.isPlaying()).toBe(true);
    const secondNode = bufferNodes[bufferNodes.length - 1]!;
    expect(secondNode.start).toHaveBeenCalledWith(0, 0); // 先頭から
    expect(pb.currentTime()).toBe(0);

    pb.dispose();
  });

  it("pause()はduration境界でクランプされた位置をstartOffsetとして捕捉する", async () => {
    const { pb, raw } = await loadedPlayback(4);
    pb.play();
    raw.currentTime = 999; // durationを大幅に超えて経過させてからpause
    pb.pause();

    expect(pb.isPlaying()).toBe(false);
    expect(pb.currentTime()).toBe(4); // 999秒分ではなくdurationにクランプされた値

    pb.dispose();
  });

  it("メトロノームOFFでもsetLoopの境界でloopAへ巻き戻る(ループ判定はmetronome非依存)", async () => {
    const { pb, raw, bufferNodes } = await loadedPlayback(10);
    pb.setLoop(1, 2);
    // metronomeは明示的にONにしない(既定でOFFのまま)
    pb.play(1); // loopAから開始
    expect(bufferNodes).toHaveLength(1);

    // 100ms刻みでpumpを駆動しつつctx時計を歩調を合わせて進める。
    // 曲内時刻(now) = startOffset(1) + 経過秒 なので、経過が1秒(=10刻み)で
    // now=2 に達しloopB(2)以上になる。
    let elapsedMs = 0;
    for (let i = 0; i < 10; i++) {
      elapsedMs += 100;
      raw.currentTime = elapsedMs / 1000;
      vi.advanceTimersByTime(100);
    }

    // seekInternalがstopNode+startNodeを呼ぶので新しいソースノードが1つ増える
    expect(bufferNodes).toHaveLength(2);
    expect(bufferNodes[1]!.start).toHaveBeenCalledWith(0, 1); // loopA(1秒)へ巻き戻り
    expect(pb.currentTime()).toBeCloseTo(1, 5);

    pb.dispose();
  });

  it("dispose後に遅れて呼ばれるload()は新しいAudioContextを作らない(StrictMode二重マウント対策)", async () => {
    const { pb, factory } = await loadedPlayback(4);
    expect(factory).toHaveBeenCalledTimes(1);

    pb.dispose();
    await pb.load(new ArrayBuffer(8)); // 破棄後に遅れて呼ばれるload
    expect(factory).toHaveBeenCalledTimes(1); // 新規contextは作られない
    expect(pb.durationSec()).toBe(4); // 既存のbufferも上書きされない
  });

  it("decodeAudioData待機中にdisposeされても、後から解決してもbufferに反映されない", async () => {
    let resolveDecode!: (buf: AudioBuffer) => void;
    const { fakeCtx } = createFakeCtx({
      duration: 4,
      decodeAudioData: () => new Promise<AudioBuffer>((resolve) => { resolveDecode = resolve; }),
    });
    const factory = vi.fn(() => fakeCtx);
    const pb = createPlayback(factory);

    const loadPromise = pb.load(new ArrayBuffer(8));
    pb.dispose(); // decode待ち中にdispose
    resolveDecode({ duration: 4 } as unknown as AudioBuffer);
    await loadPromise;

    expect(pb.durationSec()).toBe(0); // bufferは反映されない
    expect(factory).toHaveBeenCalledTimes(1); // decode開始時点の1回のみ
  });
});
