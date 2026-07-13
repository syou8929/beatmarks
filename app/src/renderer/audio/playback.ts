/** Web Audio 再生+メトロノーム(スペック §7)。クリックは拍=1046Hz、小節頭=1568Hz の
 *  減衰サイン。スケジューリングは lookahead 方式(100ms間隔で300ms先まで予約)。 */

export interface GridClick { timeSec: number; isBar: boolean }

export function clicksInWindow(
  beats: GridClick[], fromSec: number, toSec: number,
): GridClick[] {
  if (toSec <= fromSec) return [];
  return beats.filter((b) => b.timeSec >= fromSec && b.timeSec < toSec);
}

const LOOKAHEAD_MS = 100;
const SCHEDULE_AHEAD_SEC = 0.3;

export interface PlaybackEngine {
  load(bytes: ArrayBuffer): Promise<void>;
  play(fromSec?: number): void;
  pause(): void;
  stop(): void;
  seek(sec: number): void;
  currentTime(): number;
  isPlaying(): boolean;
  durationSec(): number;
  setLoop(a: number | null, b: number | null): void;
  setMetronome(on: boolean): void;
  updateGrid(beats: GridClick[]): void;
  dispose(): void;
}

export function createPlayback(
  ctxFactory: () => AudioContext = () => new AudioContext(),
): PlaybackEngine {
  let ctx: AudioContext | null = null;
  let buffer: AudioBuffer | null = null;
  let srcNode: AudioBufferSourceNode | null = null;
  let startedAtCtx = 0;      // 再生開始時のctx.currentTime
  let startOffset = 0;       // 再生開始位置(曲内秒)
  let playing = false;
  let loopA: number | null = null;
  let loopB: number | null = null;
  let metronome = false;
  let grid: GridClick[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let scheduledUntil = 0;    // 曲内秒でどこまでクリック予約済みか

  function ensureCtx(): AudioContext {
    if (!ctx) ctx = ctxFactory();
    return ctx;
  }

  function click(atCtxTime: number, isBar: boolean): void {
    const c = ensureCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.value = isBar ? 1568 : 1046;
    gain.gain.setValueAtTime(0.6, atCtxTime);
    gain.gain.exponentialRampToValueAtTime(0.001, atCtxTime + 0.06);
    osc.connect(gain).connect(c.destination);
    osc.start(atCtxTime);
    osc.stop(atCtxTime + 0.08);
  }

  function pump(): void {
    if (!playing || !metronome) return;
    const c = ensureCtx();
    const now = currentTime();
    const from = Math.max(scheduledUntil, now);
    const to = now + SCHEDULE_AHEAD_SEC;
    for (const b of clicksInWindow(grid, from, to)) {
      click(startedAtCtx + (b.timeSec - startOffset), b.isBar);
    }
    scheduledUntil = to;
    // ループ端で予約基準を巻き直すのは stop/seek 経由(下記loopハンドリング)
    if (loopA !== null && loopB !== null && now >= loopB) {
      seekInternal(loopA, true);
    }
  }

  function seekInternal(sec: number, keepPlaying: boolean): void {
    const wasPlaying = playing;
    stopNode();
    startOffset = Math.max(0, Math.min(sec, durationSec()));
    if (keepPlaying && wasPlaying) startNode();
  }

  function startNode(): void {
    const c = ensureCtx();
    if (!buffer) return;
    srcNode = c.createBufferSource();
    srcNode.buffer = buffer;
    srcNode.connect(c.destination);
    srcNode.start(0, startOffset);
    startedAtCtx = c.currentTime;
    scheduledUntil = startOffset;
    playing = true;
    if (!timer) timer = setInterval(pump, LOOKAHEAD_MS);
  }

  function stopNode(): void {
    if (srcNode) {
      try { srcNode.stop(); } catch { /* already stopped */ }
      srcNode.disconnect();
      srcNode = null;
    }
    if (playing) startOffset = currentTime();
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  function currentTime(): number {
    if (!playing || !ctx) return startOffset;
    return startOffset + (ctx.currentTime - startedAtCtx);
  }

  function durationSec(): number {
    return buffer?.duration ?? 0;
  }

  return {
    async load(bytes: ArrayBuffer): Promise<void> {
      const c = ensureCtx();
      buffer = await c.decodeAudioData(bytes.slice(0));
    },
    play(fromSec?: number): void {
      if (playing) return;
      if (fromSec !== undefined) startOffset = fromSec;
      startNode();
    },
    pause(): void { stopNode(); },
    stop(): void { stopNode(); startOffset = 0; },
    seek(sec: number): void { seekInternal(sec, true); },
    currentTime,
    isPlaying: () => playing,
    durationSec,
    setLoop(a, b) { loopA = a; loopB = b; },
    setMetronome(on) {
      metronome = on;
      scheduledUntil = currentTime(); // ONにした瞬間から予約し直す
    },
    updateGrid(beats) {
      grid = beats;
      scheduledUntil = currentTime(); // グリッド変更は即反映
    },
    dispose(): void {
      stopNode();
      void ctx?.close();
      ctx = null;
    },
  };
}
