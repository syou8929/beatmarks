/** セクション境界ドラッグの数学(スペック §7 ④)。純ロジック。 */
import { pxToSec, type Viewport } from "./waveGeom.js";

/** 元セクション(sec-o{i})の添字。追加セクション(sec-a*)・非セクションは null。 */
export function sectionIndexFromId(id: string): number | null {
  const m = id.match(/^sec-o(\d+)$/);
  return m ? parseInt(m[1]!, 10) : null;
}

/** 前後の隣接境界から minGap を空けた範囲にクランプ。 */
export function clampBoundarySec(sec: number, prevSec: number, nextSec: number, minGap: number): number {
  return Math.min(Math.max(sec, prevSec + minGap), nextSec - minGap);
}

/** px → 秒 → スナップ → クランプ の合成(⌘バイパスは snap 側で恒等を渡す)。 */
export function resolveBoundaryDrag(
  px: number, vp: Viewport, prevSec: number, nextSec: number, minGap: number,
  snap: (sec: number) => number,
): number {
  return clampBoundarySec(snap(pxToSec(px, vp)), prevSec, nextSec, minGap);
}
