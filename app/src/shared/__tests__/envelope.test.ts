import { describe, expect, it } from "vitest";

import { detectSilencesFromEnvelope, normToDb, resampleEnvelopeToFps } from "../envelope.js";
import { FPS_PRESETS } from "../timebase.js";

describe("normToDb", () => {
  it("正規化の逆変換", () => {
    expect(normToDb(1)).toBe(0);
    expect(normToDb(0.25)).toBe(-45);
    expect(normToDb(0)).toBe(-60);
  });
});

describe("detectSilencesFromEnvelope", () => {
  // 100Hz: 1秒音(0.5) / 1秒静寂(0.1 ≈ -54dB) / 1秒音(0.5)
  const total = [
    ...Array(100).fill(0.5),
    ...Array(100).fill(0.1),
    ...Array(100).fill(0.5),
  ] as number[];

  it("既定しきい値(-45dB/0.7s)で1リージョン検出", () => {
    const regions = detectSilencesFromEnvelope(total, 100, -45, 0.7);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.startSec).toBeCloseTo(1.0, 6);
    expect(regions[0]!.endSec).toBeCloseTo(2.0, 6);
    expect(regions[0]!.floorDb).toBeCloseTo(-54, 6);
  });

  it("minDurを2秒にすると検出されない(再解析なしの再フィルタ)", () => {
    expect(detectSilencesFromEnvelope(total, 100, -45, 2.0)).toHaveLength(0);
  });

  it("しきい値を-70dBに下げると検出されない", () => {
    expect(detectSilencesFromEnvelope(total, 100, -70, 0.7)).toHaveLength(0);
  });

  it("末尾まで静寂が続くケース", () => {
    const t = [...Array(50).fill(0.5), ...Array(150).fill(0.05)] as number[];
    const regions = detectSilencesFromEnvelope(t, 100, -45, 0.7);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.endSec).toBeCloseTo(2.0, 6);
  });
});

describe("resampleEnvelopeToFps", () => {
  it("長さ = floorフレーム+1、値は線形補間", () => {
    // 100Hzで0..1へ線形に上がる2秒のエンベロープ
    const env = Array.from({ length: 200 }, (_, i) => i / 199);
    const out = resampleEnvelopeToFps(env, 100, FPS_PRESETS["30"]!, 2.0);
    expect(out).toHaveLength(61); // floor(2*30)+1
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[30]!).toBeCloseTo(env[100]!, 2); // t=1.0
    expect(out[60]!).toBeCloseTo(1, 2);
    for (const v of out) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("29.97でも長さが分数計算で正しい", () => {
    const env = Array(300).fill(0.5) as number[];
    const out = resampleEnvelopeToFps(env, 100, FPS_PRESETS["29.97"]!, 3.0);
    expect(out).toHaveLength(Math.floor((3.0 * 30000) / 1001) + 1); // 89+1
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-9)).toBe(true);
  });
});
