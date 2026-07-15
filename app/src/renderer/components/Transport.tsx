/** トランスポート(スペック §7 ①): 再生/ループ/TC表示/メトロノーム/タップテンポ/手動マーカー。
 *  モックの toolbar1 相当。表示単位・スナップ・ループは viewStore を参照する。 */
import React, { useEffect, useRef, useState } from "react";

import type { GridBeat } from "../../shared/deriveGrid.js";
import { barsOf } from "../../shared/deriveGrid.js";
import { fpsLabel } from "../../shared/timebase.js";
import type { Fps } from "../../shared/types.js";
import type { PlaybackEngine } from "../audio/playback.js";
import { tapsToBpm } from "../editor/tapTempo.js";
import { formatTime } from "../editor/timeFormat.js";
import { useViewStore } from "../state/viewStore.js";
import { STRINGS } from "../strings.js";

const S = STRINGS.transport;

const groupStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, background: "#191d24",
  border: "1px solid #262c36", borderRadius: 8, padding: "4px 8px",
};
const btn: React.CSSProperties = {
  // borderColor だけを differ する toggled/primary と衝突しないよう、shorthand
  // ではなく longhand で指定する(shorthand+borderColor混在はReact再レンダー時に
  // 前の色へ戻らない実バグになるため; コミット前のRTL実行でReact警告として検出)。
  background: "#1f242d", color: "#e8ebf0",
  borderWidth: 1, borderStyle: "solid", borderColor: "#262c36",
  borderRadius: 6, padding: "4px 9px", fontSize: 11, cursor: "pointer",
};
const toggled: React.CSSProperties = { ...btn, background: "#2a3140", borderColor: "#ffd166", color: "#ffd166" };
const primary: React.CSSProperties = { ...btn, background: "#ff4d6b", borderColor: "#ff4d6b", color: "#fff", fontWeight: 700 };

/** グリッドから小節長(秒)を推定。無ければ 2 秒。 */
function barLenSec(grid: GridBeat[]): number {
  const bars = barsOf(grid);
  return bars.length >= 2 ? bars[1]!.timeSec - bars[0]!.timeSec : 2;
}

export interface TransportProps {
  playback: PlaybackEngine;
  grid: GridBeat[];
  fps: Fps;
  /** 再生状態(EditorScreenが単一の情報源として保持し渡す — T5レビュー契約)。Transport 自身は
   *  もうローカルに状態を持たない: Space ショートカット等 Transport の外から playback.play()/
   *  pause() が呼ばれても(EditorScreen が rAF ループで isPlaying を追従させるため)このコンポー
   *  ネントは常に正しいラベル/TC更新間隔で再描画される(WaveCanvas と同じ isPlaying 契約)。 */
  isPlaying: boolean;
  onAddMarker: (sec: number) => void;
  onTapTempo: (bpm: number) => void;
}

export function Transport(props: TransportProps): React.JSX.Element {
  const { playback, grid, fps, isPlaying } = props;
  const { view, dispatch } = useViewStore();
  const [metronome, setMetronome] = useState(false);
  const [, forceTick] = useState(0);
  const taps = useRef<number[]>([]);

  // 再生中は 100ms ごとに時刻表示を更新
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => forceTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [isPlaying]);

  function togglePlay(): void {
    if (playback.isPlaying()) playback.pause();
    else playback.play();
  }

  function toggleMetronome(): void {
    const next = !metronome;
    setMetronome(next);
    playback.setMetronome(next);
  }

  function toggleLoop(): void {
    if (view.loop) {
      dispatch({ type: "SET_LOOP", loop: null });
      playback.setLoop(null, null);
    } else {
      const a = playback.currentTime();
      const b = Math.min(a + barLenSec(grid), playback.durationSec());
      dispatch({ type: "SET_LOOP", loop: { a, b } });
      playback.setLoop(a, b);
    }
  }

  function setLoopEdge(edge: "a" | "b"): void {
    const t = playback.currentTime();
    const cur = view.loop ?? { a: t, b: t };
    const loop = edge === "a" ? { a: t, b: Math.max(cur.b, t) } : { a: Math.min(cur.a, t), b: t };
    dispatch({ type: "SET_LOOP", loop });
    playback.setLoop(loop.a, loop.b);
  }

  function tap(): void {
    const now = performance.now();
    if (taps.current.length && now - taps.current[taps.current.length - 1]! > 2000) taps.current = [];
    taps.current.push(now);
    const bpm = tapsToBpm(taps.current);
    if (bpm !== null) props.onTapTempo(bpm);
  }

  const tc = formatTime(playback.currentTime(), view.timeUnit, { fps, grid });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", background: "#14171c", borderBottom: "1px solid #262c36" }}>
      <div style={groupStyle}>
        <button style={btn} title={S.prevTitle} onClick={() => playback.seek(0)}>{S.prev}</button>
        <button style={primary} onClick={togglePlay}>{isPlaying ? S.pause : S.play}</button>
        <button style={view.loop ? toggled : btn} onClick={toggleLoop}>{S.loop}</button>
        <button style={btn} disabled={!view.loop} onClick={() => setLoopEdge("a")}>{S.setA}</button>
        <button style={btn} disabled={!view.loop} onClick={() => setLoopEdge("b")}>{S.setB}</button>
      </div>

      <div
        title={S.cycleUnitTitle}
        onClick={() => dispatch({ type: "CYCLE_TIME_UNIT" })}
        style={{
          fontFamily: "monospace", fontSize: 16, fontWeight: 600, letterSpacing: 1,
          background: "#0a0c10", border: "1px solid #262c36", borderRadius: 6, padding: "4px 12px", cursor: "pointer",
        }}
      >
        {tc}
        <small style={{ color: "#5a6272", fontSize: 10, marginLeft: 6 }}>@ {fpsLabel(fps)}{S.fpsDisplaySuffix}</small>
      </div>

      <div style={groupStyle}>
        <span style={{ color: "#5a6272", fontSize: 10 }}>{S.confirmGroup}</span>
        <button style={metronome ? toggled : btn} onClick={toggleMetronome}>{S.metronome}</button>
        <button style={btn} onClick={tap}>{S.tapTempo}</button>
      </div>

      <div style={groupStyle}>
        <span style={{ color: "#5a6272", fontSize: 10 }}>{S.addGroup}</span>
        <button style={btn} onClick={() => props.onAddMarker(playback.currentTime())}>{S.addMarker}</button>
      </div>
    </div>
  );
}
