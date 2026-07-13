/** renderer の単一ストア(useReducer)。編集は activeSource の EditState への
 *  純粋パッチとして表現し、スナップショットスタックで undo/redo する。 */
import type { AnalyzedProject, AnalyzeProgressEvent, ProjectFileState } from "../../shared/ipc.js";
import type { AnalysisResult, AudioSource, EditState, Fps, Marker, RoundingMode, SectionEdit } from "../../shared/types.js";
import { defaultEditState } from "../../shared/validate.js";

export interface SourceState {
  source: AudioSource;
  analysis: AnalysisResult;
  warnings: string[];
  edits: EditState;
}

export interface EditorProject {
  mediaPath: string;
  mediaHash: string;
  baseName: string;
  playbackWavPath: string;
  durationSec: number;
  sources: SourceState[];
  activeSourceId: string;
  fps: Fps;
  rounding: RoundingMode;
}

/** undo/redo スタックの1エントリ。編集操作時点でアクティブだったソースIDを
 *  スナップショットに同梱する — SOURCE_SWITCHED はスタックを積まない
 *  (undo対象外)ため、UNDO/REDO 実行時の activeSourceId は編集時のものと
 *  異なりうる。復元は必ずこの sourceId 側に適用する(現在の active 側では
 *  ない)。 */
interface UndoEntry {
  sourceId: string;
  edits: EditState;
}

export type AppState =
  | { phase: "drop" }
  | { phase: "input-config"; filePath: string; probe: import("../../shared/ipc.js").ProbeResult }
  | { phase: "analyzing"; progress: AnalyzeProgressEvent | null }
  | { phase: "editor"; project: EditorProject; undo: UndoEntry[]; redo: UndoEntry[] };

export type Action =
  | { type: "FILE_PROBED"; filePath: string; probe: import("../../shared/ipc.js").ProbeResult }
  | { type: "ANALYZE_STARTED" }
  | { type: "ANALYZE_PROGRESS"; progress: AnalyzeProgressEvent }
  | { type: "PROJECT_READY"; project: AnalyzedProject }
  | { type: "PROJECT_LOADED"; state: ProjectFileState }
  | { type: "RESET" }
  | { type: "EDIT_APPLIED"; edit: Partial<EditState> }
  | { type: "SECTION_EDIT_ADDED"; op: SectionEdit }
  | { type: "CUSTOM_MARKER_ADDED"; marker: Marker }
  | { type: "MARKER_DELETED"; id: string }
  | { type: "SOURCE_SWITCHED"; sourceId: string }
  | { type: "FPS_CHANGED"; fps: Fps }
  | { type: "ROUNDING_CHANGED"; rounding: RoundingMode }
  | { type: "UNDO" }
  | { type: "REDO" };

const UNDO_LIMIT = 100;
const GRID_KEYS: (keyof EditState)[] = [
  "bpmOverride", "gridOffsetDeltaSec", "beatsPerBar", "downbeatShift", "gridAnchor",
];

export function initialState(): AppState {
  return { phase: "drop" };
}

function activeSource(p: EditorProject): SourceState {
  const s = p.sources.find((x) => x.source.id === p.activeSourceId);
  if (!s) throw new Error(`active source not found: ${p.activeSourceId}`);
  return s;
}

function sourceById(p: EditorProject, sourceId: string): SourceState {
  const s = p.sources.find((x) => x.source.id === sourceId);
  if (!s) throw new Error(`source not found: ${sourceId}`);
  return s;
}

function withSourceEdits(p: EditorProject, sourceId: string, edits: EditState): EditorProject {
  return {
    ...p,
    sources: p.sources.map((s) => (s.source.id === sourceId ? { ...s, edits } : s)),
  };
}

/** 計画②の deriveMarkers docstring 契約: グリッド編集で beat-/bar-、
 *  silenceThreshold 変更で sil- の削除IDを無効化(除去)する。
 *  hitThreshold は意図的にここに含めない — hit-{band}-{i} は analysis.hits への
 *  配列添字そのもので常に安定(deriveMarkers.ts docstring: 解析配列添字で常に安定)。
 *  しきい値変更は出力を絞るだけで添字の再計算はしないため hit- の削除IDは腐らない。
 *  beat-/bar-/sil- はグリッド/しきい値変更のたび位置から再計算されるIDなので、
 *  そちらだけクリア対象にする。 */
function clearInvalidDeletedIds(edits: EditState, patch: Partial<EditState>): string[] {
  const touchesGrid = GRID_KEYS.some((k) => k in patch);
  const touchesSilence = "silenceThreshold" in patch;
  return edits.deletedMarkerIds.filter((id) => {
    if (touchesGrid && (id.startsWith("beat-") || id.startsWith("bar-"))) return false;
    if (touchesSilence && id.startsWith("sil-")) return false;
    return true;
  });
}

function withActiveEdits(
  state: Extract<AppState, { phase: "editor" }>,
  next: EditState,
): Extract<AppState, { phase: "editor" }> {
  const activeId = state.project.activeSourceId;
  const prev = activeSource(state.project).edits;
  return {
    ...state,
    project: withSourceEdits(state.project, activeId, next),
    undo: [...state.undo.slice(-(UNDO_LIMIT - 1)), { sourceId: activeId, edits: prev }],
    redo: [],
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "FILE_PROBED":
      return { phase: "input-config", filePath: action.filePath, probe: action.probe };
    case "ANALYZE_STARTED":
      return { phase: "analyzing", progress: null };
    case "ANALYZE_PROGRESS":
      return state.phase === "analyzing" ? { ...state, progress: action.progress } : state;
    case "RESET":
      return initialState();

    case "PROJECT_READY": {
      const p = action.project;
      return {
        phase: "editor",
        project: {
          mediaPath: p.mediaPath, mediaHash: p.mediaHash, baseName: p.baseName,
          playbackWavPath: p.playbackWavPath, durationSec: p.durationSec,
          sources: p.sources.map((s) => ({
            source: s.source, analysis: s.analysis, warnings: s.warnings,
            edits: defaultEditState(),
          })),
          activeSourceId: p.sources[0]?.source.id ?? "mix",
          fps: { num: 30, den: 1 },
          rounding: "nearest",
        },
        undo: [], redo: [],
      };
    }

    case "PROJECT_LOADED": {
      const s = action.state;
      return {
        phase: "editor",
        project: {
          mediaPath: s.mediaPath, mediaHash: s.mediaHash, baseName: s.baseName,
          playbackWavPath: s.playbackWavPath, durationSec: s.durationSec,
          sources: s.sources.map((x) => ({ ...x, warnings: [] })),
          activeSourceId: s.activeSourceId,
          fps: s.ui.fps, rounding: s.ui.rounding,
        },
        undo: [], redo: [],
      };
    }

    // フェーズ非依存(= editor 到達前でも起こりうる)アクションはここでは
    // 何もせず、下の editor 専用switchへフォールスルーさせる。
    case "EDIT_APPLIED":
    case "SECTION_EDIT_ADDED":
    case "CUSTOM_MARKER_ADDED":
    case "MARKER_DELETED":
    case "SOURCE_SWITCHED":
    case "FPS_CHANGED":
    case "ROUNDING_CHANGED":
    case "UNDO":
    case "REDO":
      break;
    default: {
      // 到達しないはず: Action に新しいtypeを追加してここを更新し忘れると
      // ここでコンパイルエラーになる(網羅性ガード)。
      const _exhaustive: never = action;
      void _exhaustive;
      break;
    }
  }

  if (state.phase !== "editor") return state;

  switch (action.type) {
    case "EDIT_APPLIED": {
      const cur = activeSource(state.project).edits;
      const next: EditState = {
        ...cur,
        ...action.edit,
        deletedMarkerIds: clearInvalidDeletedIds(cur, action.edit),
      };
      return withActiveEdits(state, next);
    }
    case "SECTION_EDIT_ADDED": {
      const cur = activeSource(state.project).edits;
      return withActiveEdits(state, { ...cur, sectionEdits: [...cur.sectionEdits, action.op] });
    }
    case "CUSTOM_MARKER_ADDED": {
      const cur = activeSource(state.project).edits;
      return withActiveEdits(state, { ...cur, customMarkers: [...cur.customMarkers, action.marker] });
    }
    case "MARKER_DELETED": {
      const cur = activeSource(state.project).edits;
      return withActiveEdits(state, {
        ...cur, deletedMarkerIds: [...cur.deletedMarkerIds, action.id],
      });
    }
    case "SOURCE_SWITCHED":
      return { ...state, project: { ...state.project, activeSourceId: action.sourceId } };
    case "FPS_CHANGED":
      return { ...state, project: { ...state.project, fps: action.fps } };
    case "ROUNDING_CHANGED":
      return { ...state, project: { ...state.project, rounding: action.rounding } };

    case "UNDO": {
      const entry = state.undo[state.undo.length - 1];
      if (!entry) return state;
      const cur = sourceById(state.project, entry.sourceId).edits;
      return {
        ...state,
        project: withSourceEdits(state.project, entry.sourceId, entry.edits),
        undo: state.undo.slice(0, -1),
        redo: [...state.redo, { sourceId: entry.sourceId, edits: cur }],
      };
    }
    case "REDO": {
      const entry = state.redo[state.redo.length - 1];
      if (!entry) return state;
      const cur = sourceById(state.project, entry.sourceId).edits;
      return {
        ...state,
        project: withSourceEdits(state.project, entry.sourceId, entry.edits),
        undo: [...state.undo, { sourceId: entry.sourceId, edits: cur }],
        redo: state.redo.slice(0, -1),
      };
    }
    default: {
      // 到達しないはず: Action に新しいtypeを追加してここを更新し忘れると
      // ここでコンパイルエラーになる(網羅性ガード)。
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
