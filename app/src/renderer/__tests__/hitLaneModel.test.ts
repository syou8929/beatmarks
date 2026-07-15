import { describe, expect, it } from "vitest";

import { hitMarkerId, visibleHitTicks } from "../editor/hitLaneModel.js";
import type { HitInfo } from "../../shared/types.js";

const hits: HitInfo[] = [
  { timeSec: 1.0, band: "low", strength: 0.9 },
  { timeSec: 1.5, band: "low", strength: 0.2 }, // しきい値未満で除外
  { timeSec: 2.0, band: "mid", strength: 0.8 }, // band違いで除外(low問い合わせ時)
  { timeSec: 9.0, band: "low", strength: 0.95 }, // 範囲外で除外
];
const toPx = (s: number) => s * 10; // T5非依存の決定的マッピング

describe("visibleHitTicks", () => {
  it("band・しきい値・表示範囲でフィルタし、元配列添字を保持する", () => {
    const ticks = visibleHitTicks(hits, "low", 0.5, 0, 5, toPx);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.index).toBe(0); // hits[0] → hit-low-0
    expect(ticks[0]!.band).toBe("low");
    expect(ticks[0]!.px).toBe(10);
    expect(ticks[0]!.strength).toBeCloseTo(0.9, 9);
  });

  it("しきい値0では範囲・band内の全ヒットを返す", () => {
    expect(visibleHitTicks(hits, "low", 0, 0, 5, toPx).map((t) => t.index)).toEqual([0, 1]);
  });

  it("index は全ヒット配列の添字(deriveMarkers の hit-{band}-{i} と一致)", () => {
    expect(visibleHitTicks(hits, "mid", 0, 0, 5, toPx)[0]!.index).toBe(2);
  });

  it("hitMarkerId は deriveMarkers と同一の id 形式(hit-{band}-{index})を生成する", () => {
    expect(hitMarkerId("low", 0)).toBe("hit-low-0");
    expect(hitMarkerId("mid", 2)).toBe("hit-mid-2");
  });

  it("deletedIds に含まれる id のヒットは除外し、後続ヒットの元添字は影響を受けない(削除で添字を詰め直さない)", () => {
    // hits[0](low, index0)を削除済み扱いにしても、hits[1](low, index1)の添字は1のまま
    // (deriveMarkers と同じ契約: idは常に元添字から計算してから判定する)。
    const deleted = new Set([hitMarkerId("low", 0)]);
    const ticks = visibleHitTicks(hits, "low", 0, 0, 5, toPx, deleted);
    expect(ticks.map((t) => t.index)).toEqual([1]);
  });

  it("deletedIds省略時は何も除外しない(後方互換のデフォルト引数)", () => {
    expect(visibleHitTicks(hits, "low", 0, 0, 5, toPx).map((t) => t.index)).toEqual([0, 1]);
  });
});
