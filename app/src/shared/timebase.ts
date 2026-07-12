/** fps・フレーム・タイムコード変換。fps は常に分数 {num, den} で厳密計算する。
 *  frame = round(t * num / den) — 都度計算のため累積誤差なし(スペック §6)。
 *  タイムコードはノンドロップ既定(スペック §6)。 */
import type { Fps, RoundingMode } from "./types.js";

export const FPS_PRESETS: Record<string, Fps> = {
  "23.976": { num: 24000, den: 1001 },
  "24": { num: 24, den: 1 },
  "25": { num: 25, den: 1 },
  "29.97": { num: 30000, den: 1001 },
  "30": { num: 30, den: 1 },
  "50": { num: 50, den: 1 },
  "59.94": { num: 60000, den: 1001 },
  "60": { num: 60, den: 1 },
};

export function fpsValue(fps: Fps): number {
  return fps.num / fps.den;
}

export function fpsLabel(fps: Fps): string {
  for (const [label, preset] of Object.entries(FPS_PRESETS)) {
    if (preset.num === fps.num && preset.den === fps.den) return label;
  }
  const v = fpsValue(fps);
  return Number.isInteger(v) ? String(v) : v.toFixed(3);
}

export function timeToFrame(timeSec: number, fps: Fps, rounding: RoundingMode): number {
  const exact = (timeSec * fps.num) / fps.den;
  const frame = rounding === "floor" ? Math.floor(exact) : Math.round(exact);
  return Math.max(0, frame);
}

export function frameToTime(frame: number, fps: Fps): number {
  return (frame * fps.den) / fps.num;
}

/** ノンドロップTC。ベースフレームレート = ceil(num/den)(29.97→30, 23.976→24)。 */
export function formatTimecode(frame: number, fps: Fps): string {
  const base = Math.ceil(fps.num / fps.den);
  const ff = frame % base;
  const totalSec = Math.floor(frame / base);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

export function formatSeconds(timeSec: number): string {
  return timeSec.toFixed(3);
}
