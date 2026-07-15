/** エディタ画面の組み立て(モック全体レイアウト、スペック §7)。ソースタブ・ショートカット・
 *  トースト・ピーク Worker 起動・書き出しフロー配線。子コンポーネントの props は実際の T4-T11
 *  実装(このリポジトリの実ソース)に合わせてある — 計画書のT12節はTask 5-11のレビュー変更が
 *  反映される前に書かれているため、そのままでは drift がある(下部の実装注を参照)。 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GridBeat } from "../../shared/deriveGrid.js";
import { getIpc } from "../ipc.js";
import { selectBars, selectGrid, selectMarkers } from "../state/selectors.js";
import type { Action, AppState, MarkerSelection } from "../state/store.js";
import { runExportFlow, type ExportOpts } from "../state/exportFlow.js";
import type { PlaybackEngine } from "../audio/playback.js";
import { keyToCommand, nudgeAction, seekTarget, type KeyCommand } from "../editor/keymap.js";
import { snapSec } from "../editor/snap.js";
import type { PeakSet } from "../editor/peaks.js";
import type { Viewport } from "../editor/waveGeom.js";
import { ViewStoreProvider, useViewStore } from "../state/viewStore.js";
import { GridBar } from "./GridBar.js";
import { HitLanes } from "./HitLanes.js";
import { MarkerTable } from "./MarkerTable.js";
import { ExportPanel } from "./ExportPanel.js";
import { Transport } from "./Transport.js";
import { Overview } from "./Overview.js";
import { SectionBand, type SectionView } from "./SectionBand.js";
import { WaveCanvas } from "./WaveCanvas.js";
import { Toast } from "./Toast.js";
import { STRINGS } from "../strings.js";

const SAMPLE_RATE = 44100; // playback wav
const EMPTY_GRID: GridBeat[] = []; // beatGridレーン非表示時にWaveCanvasへ渡す安定参照(毎レンダー[]を作ると再描画が無駄に走る)

interface EditorScreenProps {
  state: Extract<AppState, { phase: "editor" }>;
  dispatch: (a: Action) => void;
  playback: PlaybackEngine | null;
}

export function EditorScreen(props: EditorScreenProps): React.JSX.Element {
  return (
    <ViewStoreProvider>
      <EditorBody {...props} />
    </ViewStoreProvider>
  );
}

function activeSourceOrFirst(project: EditorScreenProps["state"]["project"]) {
  const s = project.sources.find((x) => x.source.id === project.activeSourceId);
  if (s) return s;
  // ⑦a持ち越し(台帳): activeSourceId が指す要素が見つからない異常系でも、素の非nullアサーション
  // で例外を投げず先頭ソースへフォールバック表示する(データ不整合の可能性はコンソールに残す)。
  console.warn(`active source not found: ${project.activeSourceId}; 先頭ソースにフォールバック`);
  return project.sources[0]!;
}

function EditorBody({ state, dispatch, playback }: EditorScreenProps): React.JSX.Element {
  const { project } = state;
  const active = activeSourceOrFirst(project);
  const { view, dispatch: viewDispatch } = useViewStore();
  const [toast, setToast] = useState<string | null>(null);
  const [widthPx, setWidthPx] = useState(800);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [peaks, setPeaks] = useState<PeakSet | null>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  // ピーク計算 Worker への参照(下のeffect参照)。エフェクト内で生成する `w` はクロージャ
  // ローカルなので、そのままだとcleanup(ソース切替/アンマウント)から参照できず計算途中の
  // Workerを終了できない — ref に退避してcleanupから w.terminate() できるようにする。
  const peaksWorkerRef = useRef<Worker | null>(null);

  const markers = selectMarkers(state);
  const grid = selectGrid(state);
  const bars = selectBars(state);

  const viewport: Viewport = {
    scrollSec: view.scrollSec, samplesPerPx: view.zoomSamplesPerPx, sampleRate: SAMPLE_RATE, widthPx,
  };
  const barIntervalSec = bars.length >= 2 ? bars[1]!.timeSec - bars[0]!.timeSec : 2;
  const anchorSec = active.edits.gridAnchor?.timeSec ?? null;

  // セクションマーカー → SectionBand の SectionView / Overview の OverviewSection ビュー
  // (OverviewSectionはstartSec/durationSec/colorのみを見るので、SectionViewをそのまま渡せる)。
  const sectionViews: SectionView[] = useMemo(
    () => markers
      .filter((m) => m.type === "section")
      .map((m) => ({ id: m.id, startSec: m.timeSec, durationSec: m.meta?.durationSec ?? 0, label: m.label, color: m.color })),
    [markers],
  );

  // レーン表示(スペック §7 ショートカット1-4)。hits/sections はコンポーネント丸ごとの
  // マウント可否で切り替える(HitLanes/SectionBandはそれ自体が独立した帯なので自然)。
  // beatGrid/silence はWaveCanvas内部の同一canvasに焼き込まれる要素なので、WaveCanvasへ渡す
  // grid/markers を絞り込むことで表現する(WaveCanvas自体はlaneVisibilityを知らない薄い描画層の
  // ままにする — T5の契約を変えない)。
  const gridForCanvas = view.laneVisibility.beatGrid ? grid : EMPTY_GRID;
  const markersForCanvas = useMemo(
    () => (view.laneVisibility.silence ? markers : markers.filter((m) => m.type !== "silence")),
    [markers, view.laneVisibility.silence],
  );

  // 幅計測(Canvas座標系のため)
  useEffect(() => {
    const el = waveRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidthPx(el.clientWidth || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // プレイヘッド追従 + 再生状態の追従。EditorScreenが単一の情報源として isPlaying を保持し、
  // Transport と WaveCanvas 両方へ渡す(T5レビュー契約)。playback.play()/pause() がどこから
  // 呼ばれても(Transportのボタン・このコンポーネントのSpaceショートカット・onEnded相当の自然
  // 終了)、次のrAFフレーム(最大約16ms)以内に isPlaying が正しく追従する。onEnded 自体は
  // createPlayback() 呼び出し元(App.tsx)のコンストラクタオプションでしかフックできない
  // (audio/playback.ts の設計: PlaybackOptions は生成時にしか渡せず、後から subscribe する
  // 手段が無い)ため、EditorScreenからはポーリングの方が素直かつ確実に配線できる。
  useEffect(() => {
    if (!playback) return;
    let raf = 0;
    const tick = (): void => {
      setPlayheadSec(playback.currentTime());
      setIsPlaying(playback.isPlaying());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playback]);

  // 波形ピーク mipmap(T2契約: Worker起動はEditorScreen=T12が行う)。再生用WAVをデコードして
  // ch0 を Worker へ渡し PeakSet を受け取る。ブリッジ/AudioContext 不在(vitest)ではスキップ
  // → peaks=null のまま(WaveCanvas/Overview は null を許容)。
  useEffect(() => {
    let bridge: ReturnType<typeof getIpc> | null = null;
    try { bridge = getIpc(); } catch { /* ブリッジ不在 */ }
    if (!bridge || typeof AudioContext === "undefined") return;
    let cancelled = false;
    const ac = new AudioContext();
    void bridge.readFileBytes(project.playbackWavPath)
      .then((bytes) => ac.decodeAudioData(bytes.slice(0)))
      .then((buf) => {
        if (cancelled) return;
        const channel = buf.getChannelData(0).slice();   // ch0 をコピー(transfer 用)
        const w = new Worker(new URL("../editor/peaks.worker.ts", import.meta.url), { type: "module" });
        peaksWorkerRef.current = w;
        w.onmessage = (e: MessageEvent<{ type: "done"; peaks: PeakSet }>) => {
          if (!cancelled) setPeaks(e.data.peaks);
          w.terminate(); // 自己終了(正常完了)
          peaksWorkerRef.current = null;
        };
        w.postMessage({ type: "build", channel, sampleRate: buf.sampleRate }, [channel.buffer]);
      })
      .catch(() => { /* ピーク無しでもグリッド/マーカーは描画する */ });
    return () => {
      cancelled = true;
      void ac.close();
      // 計算完了(onmessage)前にソース切替/アンマウントされた場合、ref経由で
      // 計算途中のWorkerを確実に終了する(guard: 完了済みならonmessageが既にnullにしている)。
      peaksWorkerRef.current?.terminate();
      peaksWorkerRef.current = null;
    };
  }, [project.playbackWavPath]);

  // CUSTOM_MARKER_ADDED は UNDO/REDO ではないので guardedDispatch を介さず素の dispatch で良い
  // (guardedDispatchはUNDO/REDOだけを横取りする薄いラッパー — store.tsのAction網羅性ガードにより
  // 新種別追加時はここも見直しが必要になる)。
  const addMarkerAt = useCallback((sec: number): void => {
    const n = active.edits.customMarkers.length + 1;
    dispatch({
      type: "CUSTOM_MARKER_ADDED",
      marker: { id: `custom-${Date.now()}`, sourceId: active.source.id, timeSec: sec, type: "custom", label: `手動${n}`, color: "#ffd166", source: "user" },
    });
  }, [active, dispatch]);

  // undo/redoはソース横断単一スタック(state.undo/redoはactiveSourceIdを問わず時系列に積む)。
  // スタック先頭のエントリが非アクティブソースのものなら、そのソースタブへ自動切替してから
  // UNDO/REDOを適用し、トーストで知らせる(台帳UX注記)。doUndoRedo自身は常に生のdispatchを
  // 使う(guardedDispatchはUNDO/REDOをこの関数へ回送するため、ここで再度guardedDispatchを
  // 呼ぶと無限再帰になる)。
  const doUndoRedo = useCallback((kind: "undo" | "redo"): void => {
    const stack = kind === "undo" ? state.undo : state.redo;
    const entry = stack[stack.length - 1];
    if (!entry) return;
    if (entry.sourceId !== project.activeSourceId) {
      dispatch({ type: "SOURCE_SWITCHED", sourceId: entry.sourceId });
      setToast(kind === "undo" ? STRINGS.editor.crossSourceUndoToast : STRINGS.editor.crossSourceRedoToast);
    }
    dispatch({ type: kind === "undo" ? "UNDO" : "REDO" });
  }, [state.undo, state.redo, project.activeSourceId, dispatch]);

  // GridBar/MarkerTable/HitLanes/ExportPanel は生の Action を dispatch する契約(それぞれ
  // 独立実装・SectionBand/Overviewと同じ契約)。そのうち UNDO/REDO だけを doUndoRedo(ソース
  // 横断自動切替+トースト付き)へ横取りする — そうしないと GridBar の Undo/Redo ボタンだけ
  // キーボード⌘Z/メニューと挙動が食い違う(タブが切り替わらないまま非表示ソースの編集を
  // 静かに戻す/やり直す)。子コンポーネントへはこのラップ版を一貫して渡す。
  const guardedDispatch = useCallback((a: Action): void => {
    if (a.type === "UNDO") { doUndoRedo("undo"); return; }
    if (a.type === "REDO") { doUndoRedo("redo"); return; }
    dispatch(a);
  }, [dispatch, doUndoRedo]);

  const runCommand = useCallback((cmd: KeyCommand): void => {
    switch (cmd.kind) {
      case "playPause": if (playback) { playback.isPlaying() ? playback.pause() : playback.play(); } break;
      case "addMarker": if (playback) addMarkerAt(playback.currentTime()); break;
      case "seek": {
        if (!playback) break;
        const points = cmd.unit === "bar" ? bars : grid;
        const t = seekTarget(points, playback.currentTime(), cmd.dir);
        if (t !== null) playback.seek(t);
        break;
      }
      case "nudge": {
        // 幻nudge防止: selectedMarker が「今アクティブなソース」由来のときだけ実際に解決する
        // (store.ts の MarkerSelection docstring / keymap.ts の nudgeAction docstring参照)。
        // markers(=selectMarkers(state))はアクティブソースのものしか持たないため、他ソースで
        // 選択中のIDがたまたま一致しても誤って引っかからないようソース一致を先にチェックする。
        const sel = state.selectedMarker;
        const selected = sel && sel.sourceId === active.source.id
          ? markers.find((m) => m.id === sel.markerId) ?? null
          : null;
        // キーリピートで1押下=1 undoエントリになる(上限100)。②cで必要ならコアレス検討。
        guardedDispatch(nudgeAction(cmd, selected, active.edits.gridOffsetDeltaSec, active.analysis.sections.length));
        break;
      }
      case "toggleLane": viewDispatch({ type: "TOGGLE_LANE", lane: cmd.lane }); break;
      case "undo": doUndoRedo("undo"); break;
      case "redo": doUndoRedo("redo"); break;
    }
  }, [playback, bars, grid, markers, state.selectedMarker, active, guardedDispatch, viewDispatch, addMarkerAt, doUndoRedo]);

  // window キーボード(スペック §7)。テキスト入力中は keyToCommand 自体が null を返すので
  // ここでは追加ガード不要。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const cmd = keyToCommand({ key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, target: e.target });
      if (!cmd) return;
      e.preventDefault();
      runCommand(cmd);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runCommand]);

  // メニュー由来 undo/redo(T11 の useProjectFile は file 操作のみ処理)。
  // ブリッジ不在(vitest)では購読しない — getIpc() の throw で描画が壊れないようガードする。
  useEffect(() => {
    let bridge: ReturnType<typeof getIpc> | null = null;
    try { bridge = getIpc(); } catch { /* ブリッジ不在 */ }
    if (!bridge) return;
    return bridge.onMenu((ev) => {
      if (ev.action === "undo") doUndoRedo("undo");
      else if (ev.action === "redo") doUndoRedo("redo");
    });
  }, [doUndoRedo]);

  const onSeek = useCallback((sec: number) => playback?.seek(sec), [playback]);
  const onExport = useCallback((opts: ExportOpts) => runExportFlow(opts, project, getIpc()), [project]);
  // オーバービューのクリック/ドラッグ: シーク+表示窓をその位置へ寄せる(OverviewのonScrubTo契約)
  const onScrubTo = useCallback((sec: number) => {
    playback?.seek(sec);
    const halfSpanSec = (widthPx * view.zoomSamplesPerPx) / SAMPLE_RATE / 2;
    viewDispatch({ type: "SET_VIEW", scrollSec: Math.max(0, sec - halfSpanSec) });
  }, [playback, widthPx, view.zoomSamplesPerPx, viewDispatch]);
  // セクション境界ドラッグのスナップ(SectionBandが要求する snap(sec)=>sec)
  const snapForBoundary = useCallback(
    (sec: number) => snapSec(sec, view.snapMode, { fps: project.fps, grid }),
    [view.snapMode, project.fps, grid],
  );
  const onSelectMarker = useCallback((id: string) => {
    const selection: MarkerSelection = { sourceId: active.source.id, markerId: id };
    guardedDispatch({ type: "MARKER_SELECTED", selection });
  }, [active.source.id, guardedDispatch]);

  // playback は App.tsx がエディタ入場時に生成する。生成前の一瞬(null)は簡易表示にフォールバックし、
  // 以降 Transport/WaveCanvas に非 null を渡す。全 hooks はこの分岐より上で呼ぶため hook 順序は不変。
  if (!playback) {
    return <div style={styles.root}><div style={{ margin: "auto", opacity: 0.7 }}>{STRINGS.editor.loadingPlayback}</div></div>;
  }

  return (
    <div style={styles.root}>
      {/* ヘッダ + ソースタブ */}
      <header style={styles.header}>
        <div style={styles.logo}>{STRINGS.app.name.slice(0, 4)}<span style={{ color: "#ff4d6b" }}>{STRINGS.app.name.slice(4)}</span></div>
        <div style={styles.filechip}><b>{project.baseName}</b></div>
        <div style={styles.tabs}>
          {project.sources.map((s) => (
            <button key={s.source.id}
              style={s.source.id === project.activeSourceId ? styles.tabOn : styles.tab}
              onClick={() => guardedDispatch({ type: "SOURCE_SWITCHED", sourceId: s.source.id })}>{s.source.label}</button>
          ))}
        </div>
      </header>

      {/* Transport(isPlayingはEditorScreenが単一の情報源として渡す。メトロノーム用GridClick変換はApp.tsxが担当) */}
      <Transport playback={playback} grid={grid} fps={project.fps} isPlaying={isPlaying}
        onAddMarker={addMarkerAt} onTapTempo={(bpm) => guardedDispatch({ type: "EDIT_APPLIED", edit: { bpmOverride: bpm } })} />

      <GridBar analysis={active.analysis} edits={active.edits} playheadSec={playheadSec}
        canUndo={state.undo.length > 0} canRedo={state.redo.length > 0} dispatch={guardedDispatch} />

      <Overview peaks={peaks} sections={sectionViews} durationSec={project.durationSec}
        viewport={viewport} playheadSec={playheadSec} onScrubTo={onScrubTo} />

      <div style={styles.wavezone}>
        {/* セクション帯はレーン表示(sections)がONのときだけマウントする(hitsレーンと同じ方式) */}
        {view.laneVisibility.sections && (
          <SectionBand
            sections={sectionViews} viewport={viewport} barIntervalSec={barIntervalSec} playheadSec={playheadSec}
            snap={snapForBoundary}
            onMoveBoundary={(index, sec) => guardedDispatch({ type: "SECTION_EDIT_ADDED", op: { op: "move", index, startSec: sec } })}
            onRename={(index, label) => guardedDispatch({ type: "SECTION_EDIT_ADDED", op: { op: "rename", index, label } })}
            onDelete={(id) => guardedDispatch({ type: "MARKER_DELETED", id })}
            onAddAtPlayhead={() => guardedDispatch({ type: "SECTION_EDIT_ADDED", op: { op: "add", startSec: playheadSec, label: STRINGS.section.defaultLabel, color: "#5b7fd4" } })}
          />
        )}
        <div ref={waveRef} style={styles.maincanvas}>
          {/* WaveCanvas(scroll/zoom は viewStore を内部購読するため viewport prop は渡さない)。
              beatGrid/silenceレーンの表示切替は grid/markers を絞り込むことで実現する(上部参照)。 */}
          <WaveCanvas
            peaks={peaks} grid={gridForCanvas} markers={markersForCanvas} anchorSec={anchorSec}
            playback={playback} sampleRate={SAMPLE_RATE} isPlaying={isPlaying}
            onSelectMarker={onSelectMarker}
            onAnchorDrag={(sec) => guardedDispatch({ type: "EDIT_APPLIED", edit: { gridAnchor: { timeSec: sec, freeBefore: active.edits.gridAnchor?.freeBefore ?? true } } })}
          />
        </div>
        {view.laneVisibility.hits && (
          <HitLanes hits={active.analysis.hits} threshold={active.edits.hitThreshold}
            deletedMarkerIds={active.edits.deletedMarkerIds}
            viewport={viewport} activeSourceId={active.source.id} selectedMarker={state.selectedMarker}
            dispatch={guardedDispatch} />
        )}
      </div>

      <div style={styles.bottom}>
        <MarkerTable activeSource={active} sources={project.sources} fps={project.fps} rounding={project.rounding}
          selectedMarker={state.selectedMarker} dispatch={guardedDispatch} onSeek={onSeek}
          onAddMarker={() => addMarkerAt(playback.currentTime())} />
        <ExportPanel fps={project.fps} rounding={project.rounding}
          sources={project.sources.map((s) => ({ id: s.source.id, label: s.source.label }))}
          activeSourceId={project.activeSourceId} dispatch={guardedDispatch} onExport={onExport} />
      </div>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#0d0f13", color: "#e8ebf0" },
  header: { display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", background: "#14171c", borderBottom: "1px solid #262c36", flex: "none" },
  logo: { fontWeight: 800, fontSize: 14 },
  filechip: { background: "#191d24", border: "1px solid #262c36", borderRadius: 6, padding: "5px 10px", color: "#8b94a3" },
  tabs: { display: "flex", gap: 6, marginLeft: "auto" },
  tab: { background: "#1f242d", color: "#8b94a3", borderWidth: 1, borderStyle: "solid", borderColor: "#262c36", borderRadius: 6, padding: "4px 10px", cursor: "pointer" },
  tabOn: { background: "#2a3140", color: "#ffd166", borderWidth: 1, borderStyle: "solid", borderColor: "#ffd166", borderRadius: 6, padding: "4px 10px", cursor: "pointer" },
  wavezone: { position: "relative", flex: "1 1 auto", minHeight: 230, display: "flex", flexDirection: "column", background: "#0d0f13", overflow: "hidden" },
  maincanvas: { flex: "1 1 auto", margin: "0 14px", position: "relative" },
  bottom: { flex: "none", height: 238, display: "flex", borderTop: "1px solid #262c36", background: "#14171c" },
};
