/** stereo-split は選択トラックのいずれかが実ステレオ(≥2ch)の時のみ提示する(台帳・スペック §3.1)。 */
export function canStereoSplit(selected: number[], channels: number[]): boolean {
  return selected.some((i) => (channels[i] ?? 0) >= 2);
}
