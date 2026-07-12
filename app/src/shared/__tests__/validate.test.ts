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
});
