/** グリッド補正バーの純ロジック。BPM/オフセット/拍子/キー表示の導出とパース。 */
import { STRINGS } from "../strings.js";
import type { AnalysisResult, EditState } from "../../shared/types.js";

export interface BpmDisplay { label: string; value: number | null; fixed: boolean; overridden: boolean; }

/** override(EditState.bpmOverride)は analysis.bpm より常に優先。override は
 *  undefined でクリア(store.ts EDIT_APPLIED の全EditStateフィールド共通規約)。
 *  可変テンポでoverrideも無い場合は数値を持たない — 表示文言は strings.ts の
 *  grid.variable("可変テンポ")を使う(コンポーネント側のローカル文言と表記を統一する)。 */
export function effectiveBpm(analysis: AnalysisResult, edits: EditState): BpmDisplay {
  const ov = edits.bpmOverride;
  if (ov !== undefined && Number.isFinite(ov) && ov > 0) {
    return { label: ov.toFixed(2), value: ov, fixed: true, overridden: true };
  }
  if (analysis.tempoMode === "fixed" && analysis.bpm != null) {
    return { label: analysis.bpm.toFixed(2), value: analysis.bpm, fixed: true, overridden: false };
  }
  return { label: STRINGS.grid.variable, value: null, fixed: false, overridden: false };
}

/** 30..300 のみ許可(スペック §3.1)。それ以外は null。空文字も Number("")===0 経由でここに落ちる。 */
export function parseBpm(text: string): number | null {
  const v = Number(text.trim());
  if (!Number.isFinite(v) || v < 30 || v > 300) return null;
  return v;
}

export function formatOffsetMs(sec: number): string {
  const ms = Math.round(sec * 1000);
  return `${ms >= 0 ? "+" : ""}${ms}ms`;
}

export const TIME_SIG_OPTIONS: { label: string; beatsPerBar: number }[] = [
  { label: "4/4", beatsPerBar: 4 },
  { label: "3/4", beatsPerBar: 3 },
  { label: "6/8", beatsPerBar: 6 },
];

export function timeSigLabel(beatsPerBar: number): string {
  return TIME_SIG_OPTIONS.find((o) => o.beatsPerBar === beatsPerBar)?.label ?? "4/4";
}

export function beatsPerBarFromLabel(label: string): number {
  return TIME_SIG_OPTIONS.find((o) => o.label === label)?.beatsPerBar ?? 4;
}

export function keyLabel(analysis: AnalysisResult): string {
  const k = analysis.key.global;
  return `${k.name} · ${k.camelot}`;
}
