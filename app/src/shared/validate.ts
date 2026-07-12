/** エンジン JSON の読み込み口。ここだけが unknown/any を扱い、以降は型が保証される。 */
import type { AnalysisResult, EditState, EngineResult } from "./types.js";

export class ValidationError extends Error {}

/** fail() は常に throw する(never)。以降の型ナローイングがこの性質に依存して
 *  いるため、ログして続行する実装に変えてはならない。 */
function fail(msg: string): never {
  throw new ValidationError(`engine result invalid: ${msg}`);
}

function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function numArray(x: unknown, name: string): number[] {
  if (!Array.isArray(x) || !x.every(isNum)) fail(`${name} must be number[]`);
  return x as number[];
}

export function parseEngineResult(jsonText: string): EngineResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    fail(`not JSON: ${e}`);
  }
  const obj = raw as Record<string, unknown>;
  const a = obj["analysis"] as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object") fail("missing analysis");
  const warnings = obj["warnings"];
  if (!Array.isArray(warnings) || !warnings.every((w) => typeof w === "string")) {
    fail("missing warnings");
  }

  if (!isNum(a["durationSec"])) fail("durationSec");
  if (a["tempoMode"] !== "fixed" && a["tempoMode"] !== "variable") fail("tempoMode");
  if (a["bpm"] !== null && !isNum(a["bpm"])) fail("bpm");
  if (!isNum(a["gridOffsetSec"])) fail("gridOffsetSec");
  numArray(a["beats"], "beats");
  if (![0, 1, 2, 3].includes(a["downbeatPhase"] as number)) fail("downbeatPhase");
  if (!Array.isArray(a["tempoMap"])) fail("tempoMap");
  const key = a["key"] as Record<string, unknown> | undefined;
  if (!key || typeof key !== "object" || !key["global"] || !Array.isArray(key["perSection"])) {
    fail("key");
  }
  if (!Array.isArray(a["sections"])) fail("sections");
  if (!Array.isArray(a["hits"])) fail("hits");
  if (!Array.isArray(a["silences"])) fail("silences");
  const env = a["envelopes"] as Record<string, unknown> | undefined;
  if (!env || !isNum(env["sampleRateHz"])) fail("envelopes");
  for (const band of ["total", "low", "mid", "high"]) {
    numArray(env[band], `envelopes.${band}`);
  }

  return { analysis: a as unknown as AnalysisResult, warnings: warnings as string[] };
}

export function defaultEditState(): EditState {
  return {
    gridOffsetDeltaSec: 0,
    beatsPerBar: 4,
    downbeatShift: 0,
    sectionEdits: [],
    hitThreshold: { low: 0, mid: 0, high: 0 },
    silenceThreshold: { db: -45, minDurSec: 0.7 },
    customMarkers: [],
    deletedMarkerIds: [],
  };
}
