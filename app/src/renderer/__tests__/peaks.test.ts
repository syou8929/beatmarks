import { describe, expect, it } from "vitest";

import { buildPeakSet, pickLevel } from "../editor/peaks.js";

describe("buildPeakSet", () => {
  it("既知ランプ配列: バケットごとに min/max が正確", () => {
    // 0..7 のランプ、bucketSize=4 → [0..3]→min0/max3, [4..7]→min4/max7
    const ch = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const ps = buildPeakSet(ch, 8, [4]);
    expect(ps.length).toBe(8);
    expect(ps.durationSec).toBeCloseTo(1, 9);
    expect(ps.levels).toHaveLength(1);
    const lv = ps.levels[0]!;
    expect(lv.samplesPerBucket).toBe(4);
    expect(Array.from(lv.min)).toEqual([0, 4]);
    expect(Array.from(lv.max)).toEqual([3, 7]);
    expect(lv.min).toBeInstanceOf(Float32Array);
  });

  it("正弦波: バケット内の min/max が符号込みで取れる", () => {
    const N = 1024;
    const ch = new Float32Array(N);
    for (let i = 0; i < N; i++) ch[i] = Math.sin((2 * Math.PI * i) / N);
    const ps = buildPeakSet(ch, N, [N]); // 全体で1バケット
    expect(ps.levels[0]!.min[0]!).toBeCloseTo(-1, 2);
    expect(ps.levels[0]!.max[0]!).toBeCloseTo(1, 2);
  });

  it("端数バケット: 長さがbucketSizeの倍数でなくても最後の端数を1バケットにする", () => {
    const ch = Float32Array.from([0, 5, -2, 9, 1]); // 5サンプル, bucket=2 → 3バケット([0,5],[-2,9],[1])
    const ps = buildPeakSet(ch, 5, [2]);
    const lv = ps.levels[0]!;
    expect(lv.min).toHaveLength(3);
    expect(Array.from(lv.min)).toEqual([0, -2, 1]);
    expect(Array.from(lv.max)).toEqual([5, 9, 1]);
  });

  it("既定 bucketSizes は [256,1024,4096,16384] の4レベル", () => {
    const ps = buildPeakSet(new Float32Array(20000), 44100);
    expect(ps.levels.map((l) => l.samplesPerBucket)).toEqual([256, 1024, 4096, 16384]);
  });

  it("空配列でも壊れない(各レベル0バケット)", () => {
    const ps = buildPeakSet(new Float32Array(0), 44100, [256]);
    expect(ps.length).toBe(0);
    expect(ps.levels[0]!.min).toHaveLength(0);
  });
});

describe("pickLevel", () => {
  const ps = buildPeakSet(new Float32Array(100000), 44100); // [256,1024,4096,16384]

  it("samplesPerPx 以下で最大の samplesPerBucket を選ぶ", () => {
    expect(pickLevel(ps, 5000).samplesPerBucket).toBe(4096);
    expect(pickLevel(ps, 4096).samplesPerBucket).toBe(4096); // 境界は「以下」で採用
    expect(pickLevel(ps, 4095).samplesPerBucket).toBe(1024);
  });

  it("どれも大きすぎる(密に拡大)ときは最小レベル", () => {
    expect(pickLevel(ps, 10).samplesPerBucket).toBe(256);
    expect(pickLevel(ps, 255).samplesPerBucket).toBe(256);
  });

  it("十分に縮小したら最大レベル", () => {
    expect(pickLevel(ps, 1e9).samplesPerBucket).toBe(16384);
  });
});
