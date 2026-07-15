/** 帯域別ヒットレーン+感度スライダー(スペック §7、モック .hitlane 準拠)。
 *  しきい値未満/削除済みは非表示(deriveMarkers のフィルタと一致)。
 *  実 store 接続は EditorScreen(T12)がコールバックを配線する(SectionBand/Overview と同じ契約)。 */
import React, { useEffect, useState } from "react";

import { HIT_COLORS } from "../../shared/deriveMarkers.js";
import type { Band, HitInfo } from "../../shared/types.js";
import { HIT_BANDS, hitMarkerId, visibleHitTicks } from "../editor/hitLaneModel.js";
import { secToPx, visibleRange, type Viewport } from "../editor/waveGeom.js";
import type { Action, MarkerSelection } from "../state/store.js";
import { STRINGS } from "../strings.js";

const S = STRINGS.hitLane;
const BAND_LABEL: Record<Band, string> = { low: S.low, mid: S.mid, high: S.high };

export interface HitLanesProps {
  hits: HitInfo[];
  threshold: { low: number; mid: number; high: number };
  deletedMarkerIds: string[]; // EditState.deletedMarkerIds をそのまま渡す想定
  viewport: Viewport;
  /** このレーンが表示しているソースのID(選択のソース限定比較・selectTick の複合キー生成に使う)。 */
  activeSourceId: string;
  selectedMarker: MarkerSelection | null;
  dispatch: (a: Action) => void;
}

export function HitLanes(props: HitLanesProps): React.JSX.Element {
  const { hits, threshold, deletedMarkerIds, viewport, activeSourceId, selectedMarker, dispatch } = props;
  const { fromSec, toSec } = visibleRange(viewport);
  const toPx = (sec: number): number => secToPx(sec, viewport);
  const deletedSet = new Set(deletedMarkerIds);

  // ドラッグ中はローカルstate、確定(pointerup/blur)でdispatch(T7レビュー judgment call、台帳)。
  // <input type="range"> の onChange は React では ネイティブ input イベントに相当し、ドラッグ中
  // 1pxごとに発火する。以前はそのたび EDIT_APPLIED を dispatch していたため、1回のドラッグ操作で
  // undo スタック(上限100)が近似値の連続で埋め尽くされ、undo が事実上使い物にならなくなっていた
  // (spec §9のリトライ思想と同根: 操作の「確定」単位を尊重する)。ticks の表示は draft(未確定値)
  // を使うので、視覚フィードバック自体は従来どおり即座("感度スライダーで即座に増減")。
  const [draft, setDraft] = useState(threshold);
  useEffect(() => { setDraft(threshold); }, [threshold]);

  function selectTick(id: string): void {
    dispatch({ type: "MARKER_SELECTED", selection: { sourceId: activeSourceId, markerId: id } });
  }
  function commit(band: Band): void {
    if (draft[band] === threshold[band]) return; // 未変更なら空のundoエントリを作らない
    dispatch({ type: "EDIT_APPLIED", edit: { hitThreshold: draft } });
  }

  return (
    <div style={styles.wrap} title={S.instantHint}>
      <span style={styles.lanetag}>{S.tag}</span>
      {HIT_BANDS.map((band) => {
        const color = HIT_COLORS[band];
        const ticks = visibleHitTicks(hits, band, draft[band], fromSec, toSec, toPx, deletedSet);
        return (
          <div key={band} style={styles.lane}>
            <span style={{ ...styles.bandtag, color }}>{BAND_LABEL[band]}</span>
            <div style={styles.strip}>
              {ticks.map((t) => {
                const id = hitMarkerId(band, t.index);
                const sel = selectedMarker !== null
                  && selectedMarker.sourceId === activeSourceId && selectedMarker.markerId === id;
                return (
                  <div
                    key={t.index}
                    role="button"
                    tabIndex={0}
                    aria-label={`hit ${band} ${t.index}`}
                    onClick={() => selectTick(id)}
                    onKeyDown={(e) => {
                      // role="button" な独自要素なのでキーボード操作(Enter/Space)を明示的に配線する
                      // (ネイティブ<button>と違い既定では何も起きないため)。
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectTick(id);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left: t.px,
                      bottom: 0,
                      width: 2,
                      height: 5 + t.strength * 15,
                      transform: "translateX(-1px)",
                      background: color,
                      opacity: 0.35 + 0.65 * t.strength,
                      cursor: "pointer",
                      outline: sel ? "1px solid #fff" : undefined,
                    }}
                  />
                );
              })}
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={draft[band]}
              aria-label={`${BAND_LABEL[band]} ${S.sensitivity}`}
              style={styles.slider}
              onChange={(e) => setDraft((d) => ({ ...d, [band]: Number(e.target.value) }))}
              onPointerUp={() => commit(band)}
              onBlur={() => commit(band)}
            />
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { position: "relative", background: "#0d0f13", borderTop: "1px solid #262c36", padding: "2px 14px 4px" },
  lanetag: { color: "#5a6272", fontSize: 10, background: "rgba(20,23,28,.8)", padding: "2px 6px", borderRadius: 4 },
  lane: { display: "flex", alignItems: "center", gap: 8, height: 22 },
  bandtag: { width: 34, fontSize: 10, flex: "none" },
  strip: { position: "relative", flex: "1 1 auto", height: "100%" },
  slider: { width: 70, flex: "none", accentColor: "#ff4d6b" },
};
