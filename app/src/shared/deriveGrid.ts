/** 解析結果+編集(EditState)から表示・書き出し用の拍/小節グリッドを導出する。
 *  エンジンは生の拍列と位相だけを返す設計(計画①の責務境界)。ここが
 *  bpmOverride / オフセット / 拍子 / 1拍目ずらし / 小節1アンカーを適用する。 */
import type { AnalysisResult, EditState } from "./types.js";

export interface GridBeat {
  timeSec: number;
  index: number;      // 適用後グリッド内の拍番号(0起点)
  isBar: boolean;
  barNumber: number;  // アンカーより前は 0, -1, … になりうる
  free: boolean;      // true = マーカー化しない(アンカー前のフリー区間)
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function deriveGrid(analysis: AnalysisResult, edits: EditState): GridBeat[] {
  const dur = analysis.durationSec;
  const bpb = Math.max(1, Math.floor(edits.beatsPerBar));

  // 1) 基礎拍列
  let times: number[];
  if (edits.bpmOverride && edits.bpmOverride > 0) {
    const period = 60 / edits.bpmOverride;
    times = [];
    for (let t = analysis.gridOffsetSec; t < dur; t += period) times.push(t);
  } else {
    times = [...analysis.beats];
  }

  // 2) オフセット微調整
  times = times
    .map((t) => t + edits.gridOffsetDeltaSec)
    .filter((t) => t >= 0 && t < dur);

  if (times.length === 0) return [];

  // 3) 位相(アンカーなし時)
  //    bpmOverride でグリッドを作り直した場合、元の downbeatPhase は元の拍列に
  //    対する位相なので厳密には無効だが、「近い拍に引き継ぐ」より 0 起点で
  //    振り直し+ユーザーが1拍目ずらしで合わせる方が予測可能なので phase を
  //    そのまま流用する(shift で補正可能)。
  let anchorIndex: number;
  if (edits.gridAnchor) {
    // 4) アンカー: 最も近い拍が小節1・拍1
    let best = 0;
    for (let i = 1; i < times.length; i++) {
      if (Math.abs(times[i]! - edits.gridAnchor.timeSec) <
          Math.abs(times[best]! - edits.gridAnchor.timeSec)) best = i;
    }
    anchorIndex = best;
  } else {
    anchorIndex = mod(analysis.downbeatPhase + edits.downbeatShift, bpb);
  }

  const freeBefore = edits.gridAnchor?.freeBefore ?? false;
  const anchorTime = times[anchorIndex]!;

  return times.map((t, i) => {
    const rel = i - anchorIndex;
    const isBar = mod(rel, bpb) === 0;
    const barNumber = Math.floor(rel / bpb) + 1;
    const free = freeBefore && t < anchorTime - 1e-9;
    return { timeSec: t, index: i, isBar, barNumber, free };
  });
}

export function barsOf(grid: GridBeat[]): GridBeat[] {
  return grid.filter((b) => b.isBar && !b.free);
}
