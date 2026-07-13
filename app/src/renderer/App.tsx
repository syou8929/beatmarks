import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { InputConfig } from "../shared/ipc.js";
import { createPlayback, type PlaybackEngine } from "./audio/playback.js";
import { getIpc } from "./ipc.js";
import { selectGrid, selectMarkers } from "./state/selectors.js";
import { initialState, reducer } from "./state/store.js";
import { STRINGS } from "./strings.js";

const box: React.CSSProperties = {
  background: "#14171c", border: "1px solid #262c36", borderRadius: 8, padding: 16,
};

export function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const playbackRef = useRef<PlaybackEngine | null>(null);
  const [metronome, setMetronome] = useState(false);
  const [playing, setPlaying] = useState(false);

  // 進捗イベント購読
  useEffect(() => {
    return getIpc().onAnalyzeProgress((ev) =>
      dispatch({ type: "ANALYZE_PROGRESS", progress: ev }),
    );
  }, []);

  // エディタ入場で再生バッファをロード
  useEffect(() => {
    if (state.phase !== "editor") return;
    const pb = createPlayback();
    playbackRef.current = pb;
    void getIpc()
      .readFileBytes(state.project.playbackWavPath)
      .then((bytes) => pb.load(bytes));
    return () => { pb.dispose(); playbackRef.current = null; };
    // playbackWavPathが変わるのは新プロジェクト時のみ
  }, [state.phase === "editor" ? state.project.playbackWavPath : null]);

  // グリッド変更をメトロノームへ反映
  const grid = useMemo(
    () => selectGrid(state).map((b) => ({ timeSec: b.timeSec, isBar: b.isBar })),
    [state],
  );
  useEffect(() => { playbackRef.current?.updateGrid(grid); }, [grid]);
  useEffect(() => { playbackRef.current?.setMetronome(metronome); }, [metronome]);

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    try {
      const path = getIpc().getPathForFile(file);
      const probe = await getIpc().probeMedia(path);
      if (probe.tracks.length <= 1) {
        await startAnalyze(path, {
          mode: "mix", trackIndexes: [0], channelSplit: "mono",
        });
      } else {
        dispatch({ type: "FILE_PROBED", filePath: path, probe });
      }
    } catch (err) {
      alert(`ファイルの読み込みに失敗しました: ${String(err)}`);
      // phaseはまだ"drop"のままなので追加のdispatchは不要(ドロップ画面に留まる)
    }
  }

  async function startAnalyze(filePath: string, input: InputConfig): Promise<void> {
    dispatch({ type: "ANALYZE_STARTED" });
    try {
      const outcome = await getIpc().analyzeMedia({ filePath, input });
      if (outcome.cancelled) {
        dispatch({ type: "RESET" }); // キャンセルは静かにドロップ画面へ
        return;
      }
      dispatch({ type: "PROJECT_READY", project: outcome.project });
    } catch (err) {
      dispatch({ type: "ANALYZE_FAILED", message: `${STRINGS.error.analyzeFailed}: ${String(err)}` });
    }
  }

  if (state.phase === "drop") {
    return (
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => void onDrop(e)}
        style={{ display: "grid", placeItems: "center", height: "100vh" }}
      >
        <div style={{ ...box, textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>BeatMarks</div>
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
            音声・動画ファイルをここにドロップ
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === "input-config") {
    return (
      <InputConfigScreen
        trackTitles={state.probe.tracks.map(
          (t, i) => t.title ?? `Track ${i + 1}(${t.channels}ch)`,
        )}
        onStart={(input) => void startAnalyze(state.filePath, input)}
      />
    );
  }

  if (state.phase === "analyzing") {
    const p = state.progress;
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        <div style={{ ...box, width: 420 }}>
          <div style={{ fontWeight: 700 }}>解析中…</div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            {p ? `${p.sourceLabel}(${p.sourceIndex + 1}/${p.sourceCount}): ${p.stage}` : "準備中"}
          </div>
          <div style={{ marginTop: 8, height: 6, background: "#262c36", borderRadius: 3 }}>
            <div style={{
              height: 6, borderRadius: 3, background: "#ff4d6b",
              width: `${p?.percent ?? 0}%`, transition: "width .2s",
            }} />
          </div>
          <button style={{ marginTop: 12 }} onClick={() => void getIpc().cancelAnalyze()}>
            キャンセル
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        <div style={{ ...box, width: 460, textAlign: "center" }}>
          <div style={{ fontWeight: 700, color: "#ff6b6b" }}>{STRINGS.error.title}</div>
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85, lineHeight: 1.6 }}>
            {state.errorMessage}
          </div>
          <button style={{ marginTop: 16 }} onClick={() => dispatch({ type: "RESET" })}>
            {STRINGS.error.back}
          </button>
        </div>
      </div>
    );
  }

  // editor(開発用の確認画面 — 本UIは計画③b)
  const active = state.project.sources.find(
    (s) => s.source.id === state.project.activeSourceId,
  )!;
  const markers = selectMarkers(state);
  return (
    <div style={{ padding: 16, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {state.project.sources.map((s) => (
          <button
            key={s.source.id}
            style={{ fontWeight: s.source.id === state.project.activeSourceId ? 700 : 400 }}
            onClick={() => dispatch({ type: "SOURCE_SWITCHED", sourceId: s.source.id })}
          >
            {s.source.label}
          </button>
        ))}
      </div>
      <div style={box}>
        <b>{state.project.baseName}</b>(
        {active.analysis.tempoMode === "fixed"
          ? `BPM ${active.analysis.bpm?.toFixed(2)}`
          : "可変テンポ"}
        ・{active.analysis.key.global.name}({active.analysis.key.global.camelot})・
        マーカー{markers.length}件・警告[{active.warnings.join(", ") || "なし"}]
      </div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={() => {
          const pb = playbackRef.current;
          if (!pb) return;
          if (pb.isPlaying()) { pb.pause(); setPlaying(false); }
          else { pb.play(); setPlaying(true); }
        }}>{playing ? "⏸ 停止" : "▶ 再生"}</button>
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={metronome}
                 onChange={(e) => setMetronome(e.target.checked)} /> メトロノーム
        </label>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          (拍グリッドの検証: クリック音がビートに合っていればOK)
        </span>
      </div>
    </div>
  );
}

function InputConfigScreen(props: {
  trackTitles: string[];
  onStart: (input: InputConfig) => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<number[]>([0]);
  const [mode, setMode] = useState<"mix" | "multitrack">("mix");
  const [split, setSplit] = useState<"mono" | "stereo-split">("mono");
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
      <div style={{ ...box, width: 480, display: "grid", gap: 10 }}>
        <b>入力設定(複数トラック検出)</b>
        {props.trackTitles.map((t, i) => (
          <label key={i} style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={selected.includes(i)}
              onChange={(e) =>
                setSelected(e.target.checked
                  ? [...selected, i].sort()
                  : selected.filter((x) => x !== i))
              }
            /> {t}
          </label>
        ))}
        <label style={{ fontSize: 13 }}>
          <input type="radio" checked={mode === "mix"} onChange={() => setMode("mix")} />
          選択トラックを2mixに統合
        </label>
        <label style={{ fontSize: 13 }}>
          <input type="radio" checked={mode === "multitrack"} onChange={() => setMode("multitrack")} />
          マルチトラックとして読み込む(トラックごとに解析)
        </label>
        {mode === "mix" && (
          <label style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={split === "stereo-split"}
              onChange={(e) => setSplit(e.target.checked ? "stereo-split" : "mono")}
            /> L/R を個別ソースとして解析
          </label>
        )}
        <button
          disabled={selected.length === 0}
          onClick={() => props.onStart({ mode, trackIndexes: selected, channelSplit: split })}
        >解析開始</button>
      </div>
    </div>
  );
}
