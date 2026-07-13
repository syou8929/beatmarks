/** スナップ(拍/小節/フレーム/なし)と nudge(±1ms/±10ms)。純ロジック(スペック §7)。 */
import { barsOf } from "../../shared/deriveGrid.js";
import { frameToTime, timeToFrame } from "../../shared/timebase.js";
import type { TimeCtx } from "./timeFormat.js";

export type SnapMode = "beat" | "bar" | "frame" | "none";

/** ソート済み時刻配列 times の中で sec に最も近い値。タイは早い方(小さい方)。 */
function nearest(times: number[], sec: number): number | null {
  if (times.length === 0) return null;
  let best = times[0]!;
  let bestD = Math.abs(best - sec);
  for (let i = 1; i < times.length; i++) {
    const d = Math.abs(times[i]! - sec);
    if (d < bestD) { best = times[i]!; bestD = d; } // strict < なので同距離は先着(早い)を保持
  }
  return best;
}

export function snapSec(sec: number, mode: SnapMode, ctx: TimeCtx): number {
  switch (mode) {
    case "none":
      return sec;
    case "frame":
      return frameToTime(timeToFrame(sec, ctx.fps, "nearest"), ctx.fps);
    case "beat":
      return nearest(ctx.grid.map((g) => g.timeSec), sec) ?? sec;
    case "bar":
      return nearest(barsOf(ctx.grid).map((g) => g.timeSec), sec) ?? sec;
  }
}

export function nudgeSec(sec: number, dir: 1 | -1, fine: boolean): number {
  return sec + dir * (fine ? 0.001 : 0.01);
}
