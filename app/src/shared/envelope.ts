/** エンベロープ(100Hz正規化系列)のフレーム再サンプルと、静寂の再フィルタ。
 *  エンジンは既定しきい値の silences と生の envelope を返す。しきい値を UI で
 *  変えたときはここで envelope から再導出する(再解析不要。スペック §5)。 */
import { frameToTime, timeToFrame } from "./timebase.js";
import type { Fps, SilenceInfo } from "./types.js";

export function normToDb(norm: number): number {
  return norm * 60 - 60;
}

export function detectSilencesFromEnvelope(
  total: number[], rateHz: number, thresholdDb: number, minDurSec: number,
): SilenceInfo[] {
  const regions: SilenceInfo[] = [];
  let start: number | null = null;
  let minDb = Infinity;

  const push = (a: number, b: number, floor: number) => {
    if ((b - a) / rateHz >= minDurSec) {
      regions.push({ startSec: a / rateHz, endSec: b / rateHz, floorDb: floor });
    }
  };

  for (let i = 0; i < total.length; i++) {
    const db = normToDb(total[i]!);
    if (db < thresholdDb) {
      if (start === null) {
        start = i;
        minDb = db;
      } else if (db < minDb) {
        minDb = db;
      }
    } else if (start !== null) {
      push(start, i, minDb);
      start = null;
      minDb = Infinity;
    }
  }
  if (start !== null) push(start, total.length, minDb);
  return regions;
}

/** フレーム0..N(N = floor(dur×fps))ごとにエンベロープ値を線形補間で返す。 */
export function resampleEnvelopeToFps(
  env: number[], rateHz: number, fps: Fps, durationSec: number,
): number[] {
  const lastFrame = timeToFrame(durationSec, fps, "floor");
  const out: number[] = new Array(lastFrame + 1);
  for (let f = 0; f <= lastFrame; f++) {
    const t = frameToTime(f, fps);
    const x = t * rateHz;
    const i = Math.floor(x);
    const frac = x - i;
    const a = env[Math.min(i, env.length - 1)] ?? 0;
    const b = env[Math.min(i + 1, env.length - 1)] ?? a;
    out[f] = a + (b - a) * frac;
  }
  return out;
}
