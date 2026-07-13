/** タップテンポ: 打点タイムスタンプ(ms)列 → 区間の中央値 → BPM(スペック §7)。 */
export function tapsToBpm(times: number[]): number | null {
  if (times.length < 4) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i]! - sorted[i - 1]!);
  intervals.sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  const median = intervals.length % 2 ? intervals[mid]! : (intervals[mid - 1]! + intervals[mid]!) / 2;
  if (median <= 0) return null;
  const bpm = 60000 / median;
  return Number.isFinite(bpm) && bpm > 0 ? bpm : null;
}
