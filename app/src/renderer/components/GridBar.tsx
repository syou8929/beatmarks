/** グリッド補正バー(モック ツールバー2 準拠、スペック §7)。BPM・オフセット nudge・
 *  拍子・1拍目ずらし・アンカー・キー表示・Undo/Redo。値はすべて EDIT_APPLIED で払い出す。
 *  canUndo/canRedo は state.undo.length>0 / state.redo.length>0 を EditorScreen(T12)が
 *  算出して渡す(このコンポーネントは AppState を直接読まない)。 */
import React from "react";

import type { AnalysisResult, EditState } from "../../shared/types.js";
import {
  beatsPerBarFromLabel, effectiveBpm, formatOffsetMs, keyLabel, parseBpm, timeSigLabel, TIME_SIG_OPTIONS,
} from "../editor/gridModel.js";
import { nudgeSec } from "../editor/snap.js";
import type { Action } from "../state/store.js";
import { STRINGS } from "../strings.js";
import { NumericField } from "./NumericField.js";

const S = STRINGS.grid;

export interface GridBarProps {
  analysis: AnalysisResult;
  edits: EditState;
  playheadSec: number;
  canUndo: boolean;
  canRedo: boolean;
  dispatch: (a: Action) => void;
}

export function GridBar(props: GridBarProps): React.JSX.Element {
  const { analysis, edits, playheadSec, canUndo, canRedo, dispatch } = props;
  const bpm = effectiveBpm(analysis, edits);
  const apply = (edit: Partial<EditState>): void => dispatch({ type: "EDIT_APPLIED", edit });

  return (
    <div style={styles.toolbar} title={S.metronomeHint}>
      {/* BPM */}
      <div style={styles.group}>
        <span style={styles.glabel}>{S.bpm}</span>
        <span style={styles.bigval}>
          <NumericField
            value={bpm.label} ariaLabel={S.bpm} width={58}
            onCommit={(text) => {
              const v = parseBpm(text);
              if (v === null) return false;
              apply({ bpmOverride: v });
              return true;
            }}
          />
        </span>
        <span style={{ ...styles.chip, color: bpm.fixed ? "#7ddc9a" : "#8b94a3" }}>
          {bpm.fixed ? S.fixed : S.variable}
        </span>
        <button onClick={() => apply({ bpmOverride: (bpm.value ?? 120) / 2 })}>{S.half}</button>
        <button onClick={() => apply({ bpmOverride: (bpm.value ?? 120) * 2 })}>{S.double}</button>
      </div>

      {/* オフセット */}
      <div style={styles.group}>
        <span style={styles.glabel}>{S.offset}</span>
        <button onClick={() => apply({ gridOffsetDeltaSec: nudgeSec(edits.gridOffsetDeltaSec, -1, false) })}>{S.minus10}</button>
        <button onClick={() => apply({ gridOffsetDeltaSec: nudgeSec(edits.gridOffsetDeltaSec, -1, true) })}>{S.minus1}</button>
        <span style={styles.offval}>{formatOffsetMs(edits.gridOffsetDeltaSec)}</span>
        <button onClick={() => apply({ gridOffsetDeltaSec: nudgeSec(edits.gridOffsetDeltaSec, 1, true) })}>{S.plus1}</button>
        <button onClick={() => apply({ gridOffsetDeltaSec: nudgeSec(edits.gridOffsetDeltaSec, 1, false) })}>{S.plus10}</button>
      </div>

      {/* 拍子 + 1拍目ずらし */}
      <div style={styles.group}>
        <span style={styles.glabel}>{S.timeSig}</span>
        <select
          aria-label={S.timeSig} value={timeSigLabel(edits.beatsPerBar)} style={styles.select}
          onChange={(e) => apply({ beatsPerBar: beatsPerBarFromLabel(e.target.value) })}
        >
          {TIME_SIG_OPTIONS.map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
        </select>
        <button title={S.downbeatTitle} onClick={() => apply({ downbeatShift: edits.downbeatShift - 1 })}>
          {S.downbeatLeft}
        </button>
        <button title={S.downbeatTitle} onClick={() => apply({ downbeatShift: edits.downbeatShift + 1 })}>
          {S.downbeatRight}
        </button>
      </div>

      {/* アンカー */}
      <div style={styles.group}>
        <button onClick={() => apply({ gridAnchor: { timeSec: playheadSec, freeBefore: true } })}>{S.anchorSet}</button>
        <button disabled={!edits.gridAnchor} onClick={() => apply({ gridAnchor: undefined })}>{S.anchorClear}</button>
      </div>

      {/* キー表示(表示のみ) */}
      <span style={styles.chip}>
        {S.key} <b style={{ color: "#9ecbff" }}>{keyLabel(analysis)}</b>{" "}
        <span style={{ color: "#5a6272" }}>{`(${S.confidence} ${analysis.key.global.confidence.toFixed(2)})`}</span>
      </span>

      {/* Undo/Redo */}
      <div style={{ ...styles.group, marginLeft: "auto" }}>
        <button aria-label={S.undo} disabled={!canUndo} onClick={() => dispatch({ type: "UNDO" })}>↶</button>
        <button aria-label={S.redo} disabled={!canRedo} onClick={() => dispatch({ type: "REDO" })}>↷</button>
      </div>
    </div>
  );
}

// border系はすべて longhand(borderWidth/Style/Color)で統一する。shorthand の border と
// borderColor 等の longhand が同一オブジェクトツリーで混在すると、状態違いのスタイルへ
// 再レンダーした際に前の色へ戻らない実バグになる(Transport.tsx の btn/toggled/primary で
// 実際に踏んだ問題、同コメント参照)。ここでは今のところ border を上書きする変種スタイルは
// 無いが、将来の状態別スタイル追加(例: 低信頼度キーの強調)に備えて最初から統一しておく。
const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", background: "#14171c",
    borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: "#262c36", flexWrap: "nowrap",
  },
  group: {
    display: "flex", alignItems: "center", gap: 6, background: "#191d24",
    borderWidth: 1, borderStyle: "solid", borderColor: "#262c36", borderRadius: 8, padding: "4px 8px",
  },
  glabel: { color: "#5a6272", fontSize: 10, marginRight: 2, whiteSpace: "nowrap" },
  bigval: { fontSize: 15, fontWeight: 700, fontFamily: "monospace" },
  chip: {
    background: "#1f242d", borderWidth: 1, borderStyle: "solid", borderColor: "#262c36",
    borderRadius: 6, padding: "3px 8px", color: "#e8ebf0", fontSize: 11,
  },
  offval: { fontFamily: "monospace", color: "#ffd166", minWidth: 52, textAlign: "center" },
  select: {
    background: "#1f242d", color: "#e8ebf0",
    borderWidth: 1, borderStyle: "solid", borderColor: "#262c36", borderRadius: 6, padding: "4px 6px", fontSize: 11,
  },
};
