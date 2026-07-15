/** マーカーテーブルの純ロジック(行の組立・フィルタ・ID解決)。 */
import { deriveMarkers } from "../../shared/deriveMarkers.js";
import type { Marker, MarkerType } from "../../shared/types.js";
import type { SourceState } from "../state/store.js";
import { STRINGS } from "../strings.js";

export interface TableRow { marker: Marker; sourceLabel: string; }

export const ALL_MARKER_TYPES: MarkerType[] = ["section", "bar", "beat", "hit", "silence", "custom"];

export function activeRows(source: SourceState): TableRow[] {
  return deriveMarkers(source.analysis, source.edits, source.source.id)
    .map((m) => ({ marker: m, sourceLabel: source.source.label }));
}

export function crossSourceRows(sources: SourceState[]): TableRow[] {
  return sources
    .flatMap((s) => deriveMarkers(s.analysis, s.edits, s.source.id).map((m) => ({ marker: m, sourceLabel: s.source.label })))
    .sort((a, b) => a.marker.timeSec - b.marker.timeSec);
}

/** 削除済み(復元候補)。削除フィルタを外して derive し、deletedMarkerIds の物だけ。 */
export function deletedRows(source: SourceState): TableRow[] {
  const del = new Set(source.edits.deletedMarkerIds);
  if (del.size === 0) return [];
  const full = deriveMarkers(source.analysis, { ...source.edits, deletedMarkerIds: [] }, source.source.id);
  return full.filter((m) => del.has(m.id)).map((m) => ({ marker: m, sourceLabel: source.source.label }));
}

export function filterByType(rows: TableRow[], enabled: Set<MarkerType>): TableRow[] {
  return rows.filter((r) => enabled.has(r.marker.type));
}

/** sec-o{n}=元添字 n / sec-a{k}=元 sections 長 + k(types.ts の index 規則)。それ以外は null。 */
export function sectionIndexFromMarkerId(id: string, originalSectionCount: number): number | null {
  const m = /^sec-([oa])(\d+)$/.exec(id);
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] === "o" ? n : originalSectionCount + n;
}

/** 行のマーカーが activeSourceId 由来かどうか。ソース横断表示(crossSourceRows)では他ソースの
 *  行も同じテーブルに混在するが、store の編集アクション(CUSTOM_MARKER_UPDATED/MARKER_DELETED/
 *  SECTION_EDIT_ADDED)はすべて「今アクティブなソース」の edits にしか適用できない
 *  (state/store.ts の withActiveEdits は常に state.project.activeSourceId 側を書き換える)。
 *  マーカー id は解析配列添字ベースの文字列(beat-0, sec-o0, …)で、ソースをまたいで同じ id が
 *  複数存在しうる(どのソースにも "beat-0" がある)。そのため非アクティブソースの行に対して
 *  削除/リネームを発行すると、見えているマーカーとは無関係な「アクティブソース側の同名添字の
 *  マーカー」を無症状で誤って書き換えてしまう — Task 6 で見つかった位置添字/元添字の取り違え
 *  (計画doc 添字バグクラス警告)と同系統の、ソース単位版の事故。呼び出し側(MarkerTable)は
 *  これで renamable/削除可能な操作を隠し、選択+シーク(閲覧・移動)だけは他ソースの行でも
 *  許可する(それらは id の等値比較のみで完結し、書き込み先を持たないため安全)。 */
export function isMutable(row: TableRow, activeSourceId: string): boolean {
  return row.marker.sourceId === activeSourceId;
}

export function typeLabel(marker: Marker): string {
  switch (marker.type) {
    case "section": return STRINGS.markerType.section;
    case "bar": return STRINGS.markerType.bar;
    case "beat": return STRINGS.markerType.beat;
    case "hit": {
      const band = marker.meta?.band;
      return STRINGS.markerTable.hitTypeTemplate(band === "low" ? "low" : band === "mid" ? "mid" : "high");
    }
    case "silence": return STRINGS.markerType.silence;
    case "custom": return STRINGS.markerType.custom;
  }
}

export function rowLabel(marker: Marker): string {
  if (marker.type === "hit") return STRINGS.markerTable.strengthTemplate(marker.meta?.strength ?? 0);
  return marker.label;
}

export function isRenamable(marker: Marker): boolean {
  return marker.type === "custom" || marker.type === "section";
}
