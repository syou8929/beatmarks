/** ヒットレーンの表示ティック(純ロジック)。deriveMarkers と同一の
 *  「strength < threshold は除外(faintにしない)」規則を守る。T5(waveGeom)には
 *  依存せず、範囲(fromSec/toSec)と座標変換(toPx)を引数で受ける。
 *
 *  削除済み(EditState.deletedMarkerIds)の除外も deriveMarkers と同じ規則で行う:
 *  id は必ず「元の analysis.hits 配列添字」から計算してから削除判定する
 *  (先に配列を絞り込んでから forEach すると後続ヒットの添字がズレる — 添字は
 *  常に元配列基準、という計画③b共通の契約に反するため厳禁)。 */
import type { Band, HitInfo } from "../../shared/types.js";

export const HIT_BANDS: Band[] = ["low", "mid", "high"];

export interface HitTick {
  index: number; // analysis.hits の配列添字(= deriveMarkers の hit-{band}-{index})
  band: Band;
  px: number; // レーン内 X
  strength: number;
}

/** deriveMarkers.ts の hit マーカーID生成(`hit-${h.band}-${i}`)と同一形式。
 *  ID組み立てをここに集約し、フィルタ側(deletedIds判定)と表示側(クリック/選択)で
 *  別々に文字列を組み立てて食い違う事故を防ぐ。 */
export function hitMarkerId(band: Band, index: number): string {
  return `hit-${band}-${index}`;
}

export function visibleHitTicks(
  hits: HitInfo[],
  band: Band,
  threshold: number,
  fromSec: number,
  toSec: number,
  toPx: (sec: number) => number,
  deletedIds: ReadonlySet<string> = new Set(),
): HitTick[] {
  const out: HitTick[] = [];
  hits.forEach((h, index) => {
    if (h.band !== band) return;
    if (h.strength < threshold) return; // deriveMarkers と同一
    if (h.timeSec < fromSec || h.timeSec > toSec) return;
    if (deletedIds.has(hitMarkerId(band, index))) return; // 削除済みは非表示(復元はT9のテーブル)
    out.push({ index, band, px: toPx(h.timeSec), strength: h.strength });
  });
  return out;
}
