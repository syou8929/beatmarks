/** マーカー一覧テーブル(モック .markers 準拠、スペック §7)。
 *  クリックでジャンプ+選択、種別フィルタ、リネーム/削除、削除済みの復元、ソース横断表示。
 *  実 store 接続は EditorScreen(T12)がコールバックを配線する(SectionBand/HitLanes と同じ契約)。 */
import React, { useRef, useState } from "react";

import type { Fps, MarkerType, RoundingMode } from "../../shared/types.js";
import { formatSeconds, formatTimecode, timeToFrame } from "../../shared/timebase.js";
import {
  activeRows, ALL_MARKER_TYPES, crossSourceRows, deletedRows, filterByType,
  isMutable, isRenamable, rowLabel, sectionIndexFromMarkerId, typeLabel, type TableRow,
} from "../editor/markerTableModel.js";
import type { Action, MarkerSelection, SourceState } from "../state/store.js";
import { STRINGS } from "../strings.js";

const S = STRINGS.markerTable;
const FILTER_LABEL: Record<MarkerType, string> = {
  section: S.filterSection, bar: S.filterBar, beat: S.filterBeat,
  hit: S.filterHit, silence: S.filterSilence, custom: S.filterCustom,
};
const DEFAULT_TYPES = new Set<MarkerType>(["section", "bar", "hit", "silence", "custom"]); // 拍は既定OFF(多い)

export interface MarkerTableProps {
  activeSource: SourceState;
  sources: SourceState[];
  fps: Fps;
  rounding: RoundingMode;
  selectedMarker: MarkerSelection | null;
  dispatch: (a: Action) => void;
  onSeek: (sec: number) => void;
  onAddMarker: () => void;
}

export function MarkerTable(props: MarkerTableProps): React.JSX.Element {
  const { activeSource, sources, fps, rounding, selectedMarker, dispatch, onSeek, onAddMarker } = props;
  const [enabled, setEnabled] = useState<Set<MarkerType>>(new Set(DEFAULT_TYPES));
  const [cross, setCross] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // SectionBand/NumericField と同じブラーガード(同コンポーネントの activeRef コメント参照):
  // 実ブラウザでは Enter/Esc による <input> のアンマウントが亡霊 blur を発火させ、同一レンダーの
  // onBlur=commitRename クロージャが古い editingId を見たまま再度実行されうる。ref は全レンダー
  // 共有の可変セルなので、古いクロージャから読んでも「このセッションは解決済みか」を正しく
  // 判定できる(jsdom はフォーカス中要素の除去で blur を発火しない仕様のため、この分岐自体は
  // このテストスイートでは踏めない — 実ブラウザ向けの保険)。
  const activeRef = useRef(false);

  const baseRows: TableRow[] = showDeleted
    ? deletedRows(activeSource)
    : cross ? crossSourceRows(sources) : activeRows(activeSource);
  // 種別フィルタ(enabled)は「今見えているマーカーを絞り込む」ための機能なので、削除済み
  // (復元候補)ビューには適用しない — 適用すると、既定OFFの拍(DEFAULT_TYPES に "beat" が
  // 無い)を削除した場合、「削除済みを表示」をONにしても復元候補が一切出ず復元できなくなる
  // (拍フィルタも別途ONにする、という気付きにくい二段階操作を要求してしまう)。復元候補は
  // 種別を問わず全件出すのが自然。
  const rows = showDeleted ? baseRows : filterByType(baseRows, enabled);
  const total = (cross ? crossSourceRows(sources) : activeRows(activeSource)).length;

  function toggleType(t: MarkerType): void {
    const next = new Set(enabled);
    next.has(t) ? next.delete(t) : next.add(t);
    setEnabled(next);
  }
  function startRename(id: string, label: string): void {
    activeRef.current = true;
    setEditingId(id);
    setDraft(label);
  }
  function commitRename(row: TableRow): void {
    if (!activeRef.current) return;
    activeRef.current = false;
    const label = draft.trim();
    setEditingId(null);
    if (!label) return; // 空ラベルは無視(SectionBand と同じ規約)
    if (row.marker.type === "custom") {
      dispatch({ type: "CUSTOM_MARKER_UPDATED", id: row.marker.id, patch: { label } });
    } else {
      // id(sec-o{i}/sec-a{k})から元添字を都度解決してから dispatch する — 位置添字ではなく
      // 元添字を使う契約は SectionBand.handleDrag/commitRename と同じ(計画③b共通の契約)。
      const idx = sectionIndexFromMarkerId(row.marker.id, activeSource.analysis.sections.length);
      if (idx !== null) dispatch({ type: "SECTION_EDIT_ADDED", op: { op: "rename", index: idx, label } });
    }
  }
  function cancelRename(): void {
    if (!activeRef.current) return;
    activeRef.current = false;
    setEditingId(null);
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.title}>
        {S.title} <span style={styles.count}>{S.countTemplate(total, rows.length)}</span>
        <div style={styles.filters}>
          {ALL_MARKER_TYPES.map((t) => (
            <button key={t} onClick={() => toggleType(t)}
              style={enabled.has(t) ? styles.chipOn : styles.chip}>{FILTER_LABEL[t]}</button>
          ))}
          <button aria-label={S.showDeletedAria} onClick={() => setShowDeleted((v) => !v)}
            style={showDeleted ? styles.chipOn : styles.chip}>{S.showDeletedLabel}</button>
          <button onClick={() => setCross((v) => !v)} style={cross ? styles.chipOn : styles.chip}>{S.crossSource}</button>
          <button onClick={onAddMarker} style={styles.chip}>{S.addButton}</button>
        </div>
      </div>
      <div style={styles.tablewrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{S.colType}</th><th style={styles.th}>{S.colLabel}</th>
              <th style={styles.th}>{S.colTimecode}</th><th style={styles.th}>{S.colFrame}</th><th style={styles.th}>{S.colSeconds}</th>
              {cross && <th style={styles.th}>{S.colTrack}</th>}
              <th style={styles.th}>{S.colSource}</th><th style={styles.th}>{S.colOp}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const m = row.marker;
              const frame = timeToFrame(m.timeSec, fps, rounding);
              // ソース限定の等値比較(m.id単体ではソース横断ビューで幻ハイライトする — store.ts の
              // MarkerSelection docstring参照)。sourceId・markerId の両方が一致したときだけ選択扱い。
              const sel = selectedMarker !== null
                && selectedMarker.sourceId === m.sourceId && selectedMarker.markerId === m.id;
              const mutable = isMutable(row, activeSource.source.id);
              // key はソースを跨いで一意な複合キーにする: m.id は解析配列添字ベースの文字列
              // (sec-o0, bar-1, beat-0, …)でソースごとに振り直されるため、ソース横断表示
              // (crossSourceRows)では複数ソースが同じ id を持ちうる(React の重複key警告/
              // 誤った行の使い回しの原因になる — isMutable のコメントと同根の「idはソース内
              // でのみ一意」という前提の別の現れ)。m.id 単体は非横断時も含めどこか他の場所
              // (dispatch のペイロード等)では引き続き素の id を使う — それらは equality
              // 比較か isMutable ガード経由で安全なため、ここは React key の一意性の話に限る。
              return (
                <tr key={`${m.sourceId}:${m.id}`} style={sel ? styles.trSel : undefined}
                  onClick={() => {
                    dispatch({ type: "MARKER_SELECTED", selection: { sourceId: m.sourceId, markerId: m.id } });
                    onSeek(m.timeSec);
                  }}>
                  <td style={styles.td}>
                    <span style={styles.typecell}>
                      <span style={{ ...styles.tdot, background: m.color }} />{typeLabel(m)}
                    </span>
                  </td>
                  <td
                    style={styles.td}
                    // 編集中(input表示中)だけ行クリック伝播を止める。編集していない通常時は
                    // ラベルセルのクリックも「行クリック=選択+シーク」として機能させたい
                    // (このセルがテーブルの中で最も広く・最もクリックされやすい列のため)。
                    onClick={(e) => { if (editingId === m.id) e.stopPropagation(); }}
                  >
                    {editingId === m.id ? (
                      <input autoFocus aria-label={S.labelEditAria(m.id)} value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => commitRename(row)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRename(row); else if (e.key === "Escape") cancelRename(); }}
                        style={styles.input} />
                    ) : rowLabel(m)}
                  </td>
                  <td style={styles.tdMono}>{formatTimecode(frame, fps)}</td>
                  <td style={styles.tdMono}>{frame}</td>
                  <td style={styles.tdMono}>{formatSeconds(m.timeSec)}</td>
                  {cross && <td style={styles.td}>{row.sourceLabel}</td>}
                  <td style={{ ...styles.td, color: m.source === "user" ? "#ffd166" : "#5a6272" }}>
                    {m.source === "user" ? S.srcUser : S.srcAuto}
                  </td>
                  <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                    {showDeleted ? (
                      <button aria-label={S.restoreAria(m.id)} onClick={() => dispatch({ type: "MARKER_RESTORED", id: m.id })}>{S.restoreButton}</button>
                    ) : mutable ? (
                      <>
                        {isRenamable(m) && (
                          <button aria-label={S.renameAria(m.id)} onClick={() => startRename(m.id, m.label)}>{S.renameGlyph}</button>
                        )}
                        <button aria-label={S.deleteAria(m.id)} onClick={() => dispatch({ type: "MARKER_DELETED", id: m.id })}>{S.deleteGlyph}</button>
                      </>
                    ) : null /* 他ソース由来の行(ソース横断表示時)は削除/リネームを出さない — isMutable 参照 */}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { flex: "1 1 auto", display: "flex", flexDirection: "column", minWidth: 0, borderRight: "1px solid #262c36" },
  title: { flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontWeight: 700, fontSize: 12, borderBottom: "1px solid #262c36" },
  count: { color: "#5a6272", fontWeight: 400 },
  filters: { marginLeft: "auto", display: "flex", gap: 4, flexWrap: "wrap" },
  // chip/chipOn はフィルタボタンの ON/OFF で入れ替わる状態違いスタイル。border は shorthand と
  // longhand を混在させず longhand(borderWidth/Style/Color)で統一する(GridBar.tsx/Transport.tsx
  // の btn/toggled/primary と同じ理由付け: shorthand の border と longhand の borderColor 等が
  // 同一オブジェクトツリーで混在すると、状態違いのスタイルへ再レンダーした際に前の色へ戻らない
  // 実バグになる)。
  chip: {
    fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "#1f242d", color: "#e8ebf0",
    borderWidth: 1, borderStyle: "solid", borderColor: "#262c36", cursor: "pointer",
  },
  chipOn: {
    fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "#1f242d", color: "#ff4d6b",
    borderWidth: 1, borderStyle: "solid", borderColor: "#ff4d6b", cursor: "pointer",
  },
  tablewrap: { flex: 1, overflow: "auto" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", color: "#5a6272", fontWeight: 600, fontSize: 10, padding: "5px 12px", borderBottom: "1px solid #262c36", position: "sticky", top: 0, background: "#14171c" },
  td: { padding: "5px 12px", borderBottom: "1px solid #1c212a", color: "#8b94a3" },
  tdMono: { padding: "5px 12px", borderBottom: "1px solid #1c212a", color: "#8b94a3", fontFamily: "monospace" },
  trSel: { background: "#232b3a" },
  typecell: { display: "inline-flex", alignItems: "center", gap: 5, color: "#e8ebf0", fontWeight: 600 },
  tdot: { width: 8, height: 8, borderRadius: 2, display: "inline-block" },
  input: {
    background: "#0a0c10", color: "#e8ebf0",
    borderWidth: 1, borderStyle: "solid", borderColor: "#3a4250", borderRadius: 4, padding: "1px 4px",
  },
};
