/** キーボードショートカットの純ロジック(スペック §7)。イベント→コマンド、シーク先、
 *  nudge のアクション解決、undo対象ソース。DOM 非依存でテスト可能。 */
import type { GridBeat } from "../../shared/deriveGrid.js";
import type { Marker } from "../../shared/types.js";
import { sectionIndexFromMarkerId } from "./markerTableModel.js";
import type { Action } from "../state/store.js";

export type LaneKey = "beatGrid" | "sections" | "hits" | "silence";

export type KeyCommand =
  | { kind: "playPause" }
  | { kind: "addMarker" }
  | { kind: "seek"; unit: "beat" | "bar"; dir: 1 | -1 }
  | { kind: "nudge"; dir: 1 | -1; coarse: boolean }
  | { kind: "toggleLane"; lane: LaneKey }
  | { kind: "undo" }
  | { kind: "redo" };

export interface KeyLike {
  key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; target: EventTarget | null;
}

const LANE_BY_DIGIT: Record<string, LaneKey> = { "1": "beatGrid", "2": "sections", "3": "hits", "4": "silence" };

function isTextInput(t: EventTarget | null): boolean {
  if (!t || typeof t !== "object" || !("tagName" in t)) return false;
  const el = t as { tagName?: string; isContentEditable?: boolean };
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true;
}

export function keyToCommand(e: KeyLike): KeyCommand | null {
  if (isTextInput(e.target)) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === "z" || e.key === "Z")) return e.shiftKey ? { kind: "redo" } : { kind: "undo" };
  if (mod) return null;
  switch (e.key) {
    case " ": return { kind: "playPause" };
    case "m": case "M": return { kind: "addMarker" };
    case "ArrowLeft": return { kind: "seek", unit: e.shiftKey ? "bar" : "beat", dir: -1 };
    case "ArrowRight": return { kind: "seek", unit: e.shiftKey ? "bar" : "beat", dir: 1 };
    case ",": return { kind: "nudge", dir: -1, coarse: e.shiftKey };
    case ".": return { kind: "nudge", dir: 1, coarse: e.shiftKey };
    default:
      return LANE_BY_DIGIT[e.key] ? { kind: "toggleLane", lane: LANE_BY_DIGIT[e.key]! } : null;
  }
}

/** dir 方向の最近傍格子点へシーク。無ければ null。 */
export function seekTarget(points: GridBeat[], curSec: number, dir: 1 | -1): number | null {
  if (dir === 1) {
    for (const p of points) if (p.timeSec > curSec + 1e-6) return p.timeSec;
    return null;
  }
  for (let i = points.length - 1; i >= 0; i--) if (points[i]!.timeSec < curSec - 1e-6) return points[i]!.timeSec;
  return null;
}

/** , / . の nudge を対象に応じたアクションへ。選択が custom→移動、section→境界移動、
 *  なし→グリッドオフセット(スペック §7「グリッドオフセットにも同じ操作系」)。
 *  selected は「アクティブソース上で選択中のマーカー」に解決済みのものを渡すこと
 *  (呼び出し側 = EditorScreen が selectedMarker の sourceId を検証してから解決する —
 *  そうしないと他ソースで選択中のマーカーIDがたまたまアクティブソースにも存在する場合、
 *  無関係なマーカーをnudgeしてしまう「幻nudge」になる。store.ts の MarkerSelection 参照)。 */
export function nudgeAction(
  cmd: { dir: 1 | -1; coarse: boolean }, selected: Marker | null,
  gridOffsetDeltaSec: number, originalSectionCount: number,
): Action {
  const delta = (cmd.coarse ? 0.01 : 0.001) * cmd.dir;
  if (selected?.type === "custom") {
    return { type: "CUSTOM_MARKER_UPDATED", id: selected.id, patch: { timeSec: selected.timeSec + delta } };
  }
  if (selected?.type === "section") {
    const idx = sectionIndexFromMarkerId(selected.id, originalSectionCount);
    if (idx !== null) return { type: "SECTION_EDIT_ADDED", op: { op: "move", index: idx, startSec: selected.timeSec + delta } };
  }
  return { type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: gridOffsetDeltaSec + delta } };
}

export function undoTargetSourceId(
  undo: { sourceId: string }[], redo: { sourceId: string }[], kind: "undo" | "redo",
): string | null {
  const stack = kind === "undo" ? undo : redo;
  return stack.length ? stack[stack.length - 1]!.sourceId : null;
}
