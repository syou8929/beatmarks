import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { InputConfig } from "../shared/ipc.js";
import { createPlayback, type PlaybackEngine } from "./audio/playback.js";
import { EditorScreen } from "./components/EditorScreen.js";
import { canStereoSplit } from "./editor/inputConfig.js";
import { useProjectFile } from "./hooks/useProjectFile.js";
import { getIpc } from "./ipc.js";
import { selectGrid } from "./state/selectors.js";
import { initialState, reducer } from "./state/store.js";
import { STRINGS } from "./strings.js";

const box: React.CSSProperties = {
  background: "#14171c", border: "1px solid #262c36", borderRadius: 8, padding: 16,
};

export function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  // メニュー(開く/保存/別名/最近)とダーティ・タイトルの配線。フェーズ非依存に購読するため
  // editor 到達前でも安全。
  useProjectFile(state, dispatch);
  const playbackRef = useRef<PlaybackEngine | null>(null);
  // EditorScreen へ prop として渡すため React state としても保持する(ref だけでは
  // playback生成/破棄が再レンダーに反映されず、EditorScreenがずっとnullのままになる)。
  const [playback, setPlayback] = useState<PlaybackEngine | null>(null);

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
    setPlayback(pb);
    void getIpc()
      .readFileBytes(state.project.playbackWavPath)
      .then((bytes) => pb.load(bytes))
      .catch((err) => alert(`${STRINGS.drop.loadFailed}: ${String(err)}`)); // onDropと同じreadFileBytes失敗時の見せ方に揃える
    return () => { pb.dispose(); playbackRef.current = null; setPlayback(null); };
    // playbackWavPathが変わるのは新プロジェクト時のみ
  }, [state.phase === "editor" ? state.project.playbackWavPath : null]);

  // グリッド変更をメトロノームへ反映(メトロノームのON/OFF自体はTransportが所有する)
  const grid = useMemo(
    () => selectGrid(state).map((b) => ({ timeSec: b.timeSec, isBar: b.isBar })),
    [state],
  );
  useEffect(() => { playbackRef.current?.updateGrid(grid); }, [grid]);

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
      alert(`${STRINGS.drop.loadFailed}: ${String(err)}`);
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
      dispatch({ type: "PROJECT_READY", project: outcome.project, input });
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
          <div style={{ fontSize: 22, fontWeight: 700 }}>{STRINGS.app.name}</div>
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
            {STRINGS.drop.prompt}
          </div>
          <div style={{ marginTop: 4, fontSize: 11, opacity: 0.5 }}>
            {STRINGS.drop.hint}
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === "input-config") {
    return (
      <InputConfigScreen
        tracks={state.probe.tracks.map((t, i) => ({
          title: t.title ?? `Track ${i + 1}(${t.channels}ch)`,
          channels: t.channels,
        }))}
        onStart={(input) => void startAnalyze(state.filePath, input)}
      />
    );
  }

  if (state.phase === "analyzing") {
    const p = state.progress;
    // 抽出フェーズ中インジケータ(台帳UX注記): 最初の進捗イベントが来るまで、または
    // stage==="extract" の間は「抽出中」表示にする(エンジンの解析ステージとは別扱い)。
    const extracting = !p || p.stage === "extract";
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        <div style={{ ...box, width: 420 }}>
          <div style={{ fontWeight: 700 }}>{extracting ? STRINGS.analyzing.extracting : STRINGS.analyzing.title}</div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            {!p
              ? STRINGS.analyzing.preparing
              : extracting
                ? STRINGS.analyzing.extracting
                : `${p.sourceLabel}(${p.sourceIndex + 1}/${p.sourceCount}): ${p.stage}`}
          </div>
          <div style={{ marginTop: 8, height: 6, background: "#262c36", borderRadius: 3 }}>
            <div style={{
              height: 6, borderRadius: 3, background: "#ff4d6b",
              width: `${p?.percent ?? 0}%`, transition: "width .2s",
            }} />
          </div>
          <button style={{ marginTop: 12 }} onClick={() => void getIpc().cancelAnalyze().catch(console.error)}>
            {STRINGS.analyzing.cancel}
          </button>
          <div style={{ marginTop: 6, fontSize: 10, color: "#5a6272" }}>{STRINGS.analyzing.cancelNote}</div>
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

  return <EditorScreen state={state} dispatch={dispatch} playback={playback} />;
}

function InputConfigScreen(props: {
  tracks: { title: string; channels: number }[];
  onStart: (input: InputConfig) => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<number[]>([0]);
  const [mode, setMode] = useState<"mix" | "multitrack">("mix");
  const [split, setSplit] = useState<"mono" | "stereo-split">("mono");
  const channels = props.tracks.map((t) => t.channels);
  const stereoOk = canStereoSplit(selected, channels);
  // 選択がモノだけになったら stereo-split を強制解除(台帳UX注記: probeのchannelsを参照して
  // 実質ステレオの選択があるときだけ提示する)。
  useEffect(() => { if (!stereoOk && split === "stereo-split") setSplit("mono"); }, [stereoOk, split]);

  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
      <div style={{ ...box, width: 480, display: "grid", gap: 10 }}>
        <b>{STRINGS.inputConfig.title}</b>
        {props.tracks.map((t, i) => (
          <label key={i} style={{ fontSize: 13 }}>
            <input type="checkbox" checked={selected.includes(i)}
              onChange={(e) => setSelected(e.target.checked ? [...selected, i].sort() : selected.filter((x) => x !== i))} /> {t.title}
          </label>
        ))}
        <label style={{ fontSize: 13 }}>
          <input type="radio" checked={mode === "mix"} onChange={() => setMode("mix")} /> {STRINGS.inputConfig.mixMode}
        </label>
        <label style={{ fontSize: 13 }}>
          <input type="radio" checked={mode === "multitrack"} onChange={() => setMode("multitrack")} /> {STRINGS.inputConfig.multitrackMode}
        </label>
        {mode === "mix" && stereoOk && (
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={split === "stereo-split"}
              onChange={(e) => setSplit(e.target.checked ? "stereo-split" : "mono")} /> {STRINGS.inputConfig.stereoSplit}
          </label>
        )}
        <button disabled={selected.length === 0}
          onClick={() => props.onStart({ mode, trackIndexes: selected, channelSplit: split })}>{STRINGS.inputConfig.start}</button>
      </div>
    </div>
  );
}
