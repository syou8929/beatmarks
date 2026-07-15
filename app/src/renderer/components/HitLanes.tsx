/** 帯域別ヒットレーン+感度スライダー(スペック §7、モック .hitlane 準拠)。
 *  しきい値未満/削除済みは非表示(deriveMarkers のフィルタと一致)。
 *  実 store 接続は EditorScreen(T12)がコールバックを配線する(SectionBand/Overview と同じ契約)。 */
import React from "react";

import { HIT_COLORS } from "../../shared/deriveMarkers.js";
import type { Band, HitInfo } from "../../shared/types.js";
import { HIT_BANDS, hitMarkerId, visibleHitTicks } from "../editor/hitLaneModel.js";
import { secToPx, visibleRange, type Viewport } from "../editor/waveGeom.js";
import type { Action } from "../state/store.js";
import { STRINGS } from "../strings.js";

const S = STRINGS.hitLane;
const BAND_LABEL: Record<Band, string> = { low: S.low, mid: S.mid, high: S.high };

export interface HitLanesProps {
  hits: HitInfo[];
  threshold: { low: number; mid: number; high: number };
  deletedMarkerIds: string[]; // EditState.deletedMarkerIds をそのまま渡す想定
  viewport: Viewport;
  selectedMarkerId: string | null;
  dispatch: (a: Action) => void;
}

export function HitLanes(props: HitLanesProps): React.JSX.Element {
  const { hits, threshold, deletedMarkerIds, viewport, selectedMarkerId, dispatch } = props;
  const { fromSec, toSec } = visibleRange(viewport);
  const toPx = (sec: number): number => secToPx(sec, viewport);
  const deletedSet = new Set(deletedMarkerIds);

  function selectTick(id: string): void {
    dispatch({ type: "MARKER_SELECTED", markerId: id });
  }

  return (
    <div style={styles.wrap} title={S.instantHint}>
      <span style={styles.lanetag}>{S.tag}</span>
      {HIT_BANDS.map((band) => {
        const color = HIT_COLORS[band];
        const ticks = visibleHitTicks(hits, band, threshold[band], fromSec, toSec, toPx, deletedSet);
        return (
          <div key={band} style={styles.lane}>
            <span style={{ ...styles.bandtag, color }}>{BAND_LABEL[band]}</span>
            <div style={styles.strip}>
              {ticks.map((t) => {
                const id = hitMarkerId(band, t.index);
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
                      outline: id === selectedMarkerId ? "1px solid #fff" : undefined,
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
              value={threshold[band]}
              aria-label={`${BAND_LABEL[band]} ${S.sensitivity}`}
              style={styles.slider}
              onChange={(e) =>
                dispatch({
                  type: "EDIT_APPLIED",
                  edit: { hitThreshold: { ...threshold, [band]: Number(e.target.value) } },
                })
              }
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
