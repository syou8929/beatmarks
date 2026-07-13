/** 波形ピークの mipmap(ズームレベル別の min/max)。Worker でプリ計算し Canvas 描画で使う。
 *  各レベルは samplesPerBucket ごとに [min,max] を Float32Array で持つ(スペック §7)。 */

export interface PeakLevel {
  samplesPerBucket: number;
  min: Float32Array;
  max: Float32Array;
}

export interface PeakSet {
  durationSec: number;
  sampleRate: number;
  length: number;
  levels: PeakLevel[];
}

export const DEFAULT_BUCKET_SIZES = [256, 1024, 4096, 16384] as const;

function buildLevel(channel: Float32Array, samplesPerBucket: number): PeakLevel {
  const n = channel.length;
  const bucketCount = Math.ceil(n / samplesPerBucket);
  const min = new Float32Array(bucketCount);
  const max = new Float32Array(bucketCount);
  for (let b = 0; b < bucketCount; b++) {
    const start = b * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, n); // 最後の端数バケットは end<start+bucket
    let lo = channel[start]!;
    let hi = lo;
    for (let i = start + 1; i < end; i++) {
      const v = channel[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { samplesPerBucket, min, max };
}

export function buildPeakSet(
  channel: Float32Array,
  sampleRate: number,
  bucketSizes: readonly number[] = DEFAULT_BUCKET_SIZES,
): PeakSet {
  return {
    durationSec: sampleRate > 0 ? channel.length / sampleRate : 0,
    sampleRate,
    length: channel.length,
    levels: bucketSizes.map((s) => buildLevel(channel, s)),
  };
}

/** 表示密度 samplesPerPx に最も近いレベル: samplesPerBucket ≤ samplesPerPx の最大、
 *  無ければ(密に拡大しすぎ)最小レベルを返す。 */
export function pickLevel(peaks: PeakSet, samplesPerPx: number): PeakLevel {
  let eligible: PeakLevel | null = null;
  let smallest = peaks.levels[0]!;
  for (const lv of peaks.levels) {
    if (lv.samplesPerBucket < smallest.samplesPerBucket) smallest = lv;
    if (lv.samplesPerBucket <= samplesPerPx) {
      if (!eligible || lv.samplesPerBucket > eligible.samplesPerBucket) eligible = lv;
    }
  }
  return eligible ?? smallest;
}
