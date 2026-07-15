/** オーバービュー(曲全体)の座標変換。表示窓の矩形算出(スペック §7 ③)。 */
import { visibleRange, type Viewport } from "./waveGeom.js";

export function overviewXToSec(x: number, widthPx: number, durationSec: number): number {
  return durationSec > 0 && widthPx > 0 ? (x / widthPx) * durationSec : 0;
}
export function overviewSecToX(sec: number, widthPx: number, durationSec: number): number {
  return durationSec > 0 ? (sec / durationSec) * widthPx : 0;
}
export function overviewWindowRect(
  durationSec: number, vp: Viewport, widthPx: number,
): { x: number; w: number } {
  if (durationSec <= 0) return { x: 0, w: 0 };
  const { fromSec, toSec } = visibleRange(vp);
  const x = overviewSecToX(fromSec, widthPx, durationSec);
  const w = overviewSecToX(toSec, widthPx, durationSec) - x;
  return { x, w };
}
