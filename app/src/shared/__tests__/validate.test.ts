import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseEngineResult, ValidationError, defaultEditState } from "../validate.js";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "analysis-30s.json",
);

describe("parseEngineResult", () => {
  it("エンジン実出力のfixtureをパースできる", () => {
    const r = parseEngineResult(readFileSync(FIXTURE, "utf-8"));
    expect(Math.abs(r.analysis.durationSec - 30)).toBeLessThan(0.1);
    expect(r.analysis.beats.length).toBeGreaterThan(30);
    expect(["fixed", "variable"]).toContain(r.analysis.tempoMode);
    expect([0, 1, 2, 3]).toContain(r.analysis.downbeatPhase);
    expect(r.analysis.sections[0]!.startSec).toBe(0);
    expect(r.analysis.key.perSection.length).toBe(r.analysis.sections.length);
    expect(r.analysis.envelopes.sampleRateHz).toBe(100);
    expect(r.analysis.hits.length).toBeGreaterThan(0);
    expect(Array.isArray(r.warnings)).toBe(true);
  });

  it("壊れたJSONはValidationError", () => {
    expect(() => parseEngineResult("not json")).toThrow(ValidationError);
  });

  it("形が違うJSONはValidationError", () => {
    expect(() => parseEngineResult('{"analysis": {"nope": 1}}')).toThrow(ValidationError);
    expect(() => parseEngineResult('{"warnings": []}')).toThrow(ValidationError);
  });

  it("defaultEditStateは編集なしを表す", () => {
    const e = defaultEditState();
    expect(e.gridOffsetDeltaSec).toBe(0);
    expect(e.beatsPerBar).toBe(4);
    expect(e.downbeatShift).toBe(0);
    expect(e.sectionEdits).toEqual([]);
    expect(e.hitThreshold).toEqual({ low: 0, mid: 0, high: 0 });
    expect(e.silenceThreshold).toEqual({ db: -45, minDurSec: 0.7 });
    expect(e.customMarkers).toEqual([]);
    expect(e.deletedMarkerIds).toEqual([]);
  });

  // レビュー指摘(Important): sections/hits/silences 配列の要素検証深化。
  // 再現したTypeError: analysis.sections/hits:[null] は deriveMarkers.ts の
  // `analysis.sections.map((s) => ...)` / `analysis.hits.forEach((h) => ...)` で
  // 最初の描画時にクラッシュしていた。
  describe("sections/hits/silences の要素検証(レビュー再現)", () => {
    function baseAnalysis(): Record<string, unknown> {
      return {
        durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.1, beats: [0.1, 0.6],
        downbeatPhase: 0, tempoMap: [],
        key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
        sections: [{ startSec: 0, endSec: 10, label: "A", clusterId: 0, chorusCandidate: false }],
        hits: [{ timeSec: 1, band: "low", strength: 0.5 }],
        silences: [{ startSec: 2, endSec: 3, floorDb: -50 }],
        envelopes: { sampleRateHz: 100, total: [0.1], low: [0.1], mid: [0.1], high: [0.1] },
      };
    }
    function wrap(a: Record<string, unknown>): string {
      return JSON.stringify({ analysis: a, warnings: [] });
    }
    function expectTypedError(fn: () => void, pattern: RegExp): void {
      let caught: unknown;
      try { fn(); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught).not.toBeInstanceOf(TypeError);
      expect((caught as Error).message).toMatch(pattern);
    }

    it("baseAnalysisの正常形は通る", () => {
      expect(() => parseEngineResult(wrap(baseAnalysis()))).not.toThrow();
    });

    it("sections:[null] はTypeErrorでなくValidationError(レビュー再現)", () => {
      expectTypedError(
        () => parseEngineResult(wrap({ ...baseAnalysis(), sections: [null] })),
        /sections/,
      );
    });
    it("sections[].startSec 欠落を検出", () => {
      const a = { ...baseAnalysis(), sections: [{ label: "A" }] };
      expect(() => parseEngineResult(wrap(a))).toThrow(/sections\[0\]\.startSec/);
    });
    it("sections[].label 欠落を検出", () => {
      const a = { ...baseAnalysis(), sections: [{ startSec: 0 }] };
      expect(() => parseEngineResult(wrap(a))).toThrow(/sections\[0\]\.label/);
    });

    it("hits:[null] はTypeErrorでなくValidationError(レビュー再現)", () => {
      expectTypedError(
        () => parseEngineResult(wrap({ ...baseAnalysis(), hits: [null] })),
        /hits/,
      );
    });
    it("hits[].timeSec 欠落を検出", () => {
      const a = { ...baseAnalysis(), hits: [{ band: "low", strength: 0.5 }] };
      expect(() => parseEngineResult(wrap(a))).toThrow(/hits\[0\]\.timeSec/);
    });
    it("hits[].band 列挙外を検出", () => {
      const a = { ...baseAnalysis(), hits: [{ timeSec: 1, band: "bogus", strength: 0.5 }] };
      expect(() => parseEngineResult(wrap(a))).toThrow(/hits\[0\]\.band/);
    });
    it("hits[].strength 欠落を検出", () => {
      const a = { ...baseAnalysis(), hits: [{ timeSec: 1, band: "low" }] };
      expect(() => parseEngineResult(wrap(a))).toThrow(/hits\[0\]\.strength/);
    });

    it("silences:[null] はTypeErrorでなくValidationError", () => {
      expectTypedError(
        () => parseEngineResult(wrap({ ...baseAnalysis(), silences: [null] })),
        /silences/,
      );
    });
    it("silences[].startSec 欠落を検出", () => {
      const a = { ...baseAnalysis(), silences: [{ endSec: 3 }] };
      expect(() => parseEngineResult(wrap(a))).toThrow(/silences\[0\]\.startSec/);
    });
    it("silences[].endSec 欠落を検出", () => {
      const a = { ...baseAnalysis(), silences: [{ startSec: 2 }] };
      expect(() => parseEngineResult(wrap(a))).toThrow(/silences\[0\]\.endSec/);
    });

    it("実エンジンfixtureは要素検証後も通る(回帰確認)", () => {
      const r = parseEngineResult(readFileSync(FIXTURE, "utf-8"));
      expect(r.analysis.sections.length).toBeGreaterThan(0);
      expect(r.analysis.hits.length).toBeGreaterThan(0);
      expect(r.analysis.silences).toEqual([]);
    });
  });
});
