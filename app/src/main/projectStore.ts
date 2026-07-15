/** .bmk(実体はJSON)の保存/読込(スペック §3.5, §6)。dialogはmain/index.tsで注入。 */
import { readFile, rename, unlink, writeFile } from "node:fs/promises";

import type { ProjectFileState } from "../shared/ipc.js";
import { parseEngineResult } from "../shared/validate.js";

function isNum(x: unknown): x is number { return typeof x === "number" && Number.isFinite(x); }
function isInt(x: unknown): x is number { return isNum(x) && Number.isInteger(x); }

function validateAnalysis(a: unknown, path: string): void {
  try { parseEngineResult(JSON.stringify({ analysis: a, warnings: [] })); }
  catch (e) { throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`); }
}

const SECTION_EDIT_OPS = new Set(["move", "rename", "recolor", "delete", "add"]);

/** SectionEdit 要素の検証(レビュー再現: sectionEdits:[null] で deriveMarkers.ts の
 *  `for (const e of edits.sectionEdits) { if (e.op === "add")` が TypeError になる)。
 *  shared/types.ts の SectionEdit 判別共用体に沿って op ごとの必須フィールドのみを
 *  最小限検証する(index の範囲外はderiveMarkers側で無視される既定動作のため、
 *  ここでは型のみ見る)。 */
function validateSectionEdit(raw: unknown, path: string): void {
  if (typeof raw !== "object" || raw === null) throw new Error(`${path} が不正です`);
  const e = raw as Record<string, unknown>;
  const op = e["op"];
  if (typeof op !== "string" || !SECTION_EDIT_OPS.has(op)) throw new Error(`${path}.op が不正です`);
  if (op === "add") {
    if (!isNum(e["startSec"])) throw new Error(`${path}.startSec が不正です`);
    if (typeof e["label"] !== "string") throw new Error(`${path}.label が不正です`);
    if (typeof e["color"] !== "string") throw new Error(`${path}.color が不正です`);
    return;
  }
  if (!isInt(e["index"]) || (e["index"] as number) < 0) throw new Error(`${path}.index が不正です`);
  if (op === "move" && !isNum(e["startSec"])) throw new Error(`${path}.startSec が不正です`);
  if (op === "rename" && typeof e["label"] !== "string") throw new Error(`${path}.label が不正です`);
  if (op === "recolor" && typeof e["color"] !== "string") throw new Error(`${path}.color が不正です`);
}

/** customMarkers 要素の検証(レビュー再現同様のクラス: 壊れた要素はderiveMarkers.ts
 *  の `out.push({ ...c, sourceId, source: "user" })` をそのまま素通りしてしまい、
 *  id/timeSec/label欠落のマーカーが描画・書き出しパイプラインに混入する)。
 *  shared/types.ts の Marker のうち、deriveMarkers/consumers が実際に読む
 *  id・timeSec・label・type(常に "custom")だけを最小限検証する。 */
function validateCustomMarker(raw: unknown, path: string): void {
  if (typeof raw !== "object" || raw === null) throw new Error(`${path} が不正です`);
  const m = raw as Record<string, unknown>;
  if (typeof m["id"] !== "string") throw new Error(`${path}.id が不正です`);
  if (!isNum(m["timeSec"])) throw new Error(`${path}.timeSec が不正です`);
  if (typeof m["label"] !== "string") throw new Error(`${path}.label が不正です`);
  if (m["type"] !== "custom") throw new Error(`${path}.type が不正です`);
}

function validateEditState(raw: unknown, path: string): void {
  if (typeof raw !== "object" || raw === null) throw new Error(`${path} が不正です`);
  const e = raw as Record<string, unknown>;
  if (!isNum(e["gridOffsetDeltaSec"])) throw new Error(`${path}.gridOffsetDeltaSec が不正です`);
  if (!isNum(e["beatsPerBar"])) throw new Error(`${path}.beatsPerBar が不正です`);
  if (!isNum(e["downbeatShift"])) throw new Error(`${path}.downbeatShift が不正です`);
  if (e["bpmOverride"] !== undefined && !isNum(e["bpmOverride"])) throw new Error(`${path}.bpmOverride が不正です`);
  const anchor = e["gridAnchor"];
  if (anchor !== undefined) {
    const a = anchor as Record<string, unknown>;
    if (typeof anchor !== "object" || anchor === null || !isNum(a["timeSec"]) || typeof a["freeBefore"] !== "boolean") {
      throw new Error(`${path}.gridAnchor が不正です`);
    }
  }
  const ht = e["hitThreshold"] as Record<string, unknown> | undefined;
  if (!ht || typeof ht !== "object" || !isNum(ht["low"]) || !isNum(ht["mid"]) || !isNum(ht["high"])) {
    throw new Error(`${path}.hitThreshold が不正です`);
  }
  const st = e["silenceThreshold"] as Record<string, unknown> | undefined;
  if (!st || typeof st !== "object" || !isNum(st["db"]) || !isNum(st["minDurSec"])) {
    throw new Error(`${path}.silenceThreshold が不正です`);
  }
  const sectionEdits = e["sectionEdits"];
  if (!Array.isArray(sectionEdits)) throw new Error(`${path}.sectionEdits が不正です`);
  sectionEdits.forEach((se, i) => validateSectionEdit(se, `${path}.sectionEdits[${i}]`));
  const customMarkers = e["customMarkers"];
  if (!Array.isArray(customMarkers)) throw new Error(`${path}.customMarkers が不正です`);
  customMarkers.forEach((m, i) => validateCustomMarker(m, `${path}.customMarkers[${i}]`));
  const deletedMarkerIds = e["deletedMarkerIds"];
  if (!Array.isArray(deletedMarkerIds) || !deletedMarkerIds.every((x) => typeof x === "string")) {
    throw new Error(`${path}.deletedMarkerIds が不正です`);
  }
}

function validateSource(raw: unknown, i: number): void {
  const path = `sources[${i}]`;
  if (typeof raw !== "object" || raw === null) throw new Error(`${path} が不正です`);
  const s = raw as Record<string, unknown>;
  const src = s["source"] as Record<string, unknown> | undefined;
  if (!src || typeof src !== "object" || typeof src["id"] !== "string" ||
      (src["kind"] !== "mix" && src["kind"] !== "track" && src["kind"] !== "channel") ||
      typeof src["label"] !== "string") {
    throw new Error(`${path}.source が不正です`);
  }
  validateAnalysis(s["analysis"], `${path}.analysis`);
  validateEditState(s["edits"], `${path}.edits`);
}

/** InputConfig の深化検証(台帳追加要件)。再オープン時の再抽出をユーザーの元選択に
 *  忠実にするため .bmk に永続化しており、壊れた/欠落した input は再抽出の忠実性が
 *  失われる(トラック取り違え)ため他フィールドと同様に厳格検査する。 */
function validateInputConfig(raw: unknown, path: string): void {
  if (typeof raw !== "object" || raw === null) throw new Error(`${path} が不正です`);
  const c = raw as Record<string, unknown>;
  if (c["mode"] !== "mix" && c["mode"] !== "multitrack") {
    throw new Error(`${path}.mode が不正です`);
  }
  const tracks = c["trackIndexes"];
  if (!Array.isArray(tracks) || tracks.length === 0 || !tracks.every((x) => isInt(x) && x >= 0)) {
    throw new Error(`${path}.trackIndexes が不正です`);
  }
  if (c["channelSplit"] !== "mono" && c["channelSplit"] !== "stereo-split") {
    throw new Error(`${path}.channelSplit が不正です`);
  }
}

export function validateProjectFile(raw: unknown): ProjectFileState {
  if (typeof raw !== "object" || raw === null) throw new Error(".bmk の形式が不正です");
  const o = raw as Record<string, unknown>;
  if (o["version"] !== 1) throw new Error(`未対応の .bmk version: ${String(o["version"])}(対応: 1)`);
  for (const key of ["mediaPath", "mediaHash", "baseName", "activeSourceId"]) {
    if (typeof o[key] !== "string") throw new Error(`.bmk の ${key} が不正です`);
  }
  if (typeof o["durationSec"] !== "number") throw new Error(".bmk の durationSec が不正です");
  validateInputConfig(o["input"], ".bmk の input");
  if (!Array.isArray(o["sources"])) throw new Error(".bmk の sources が不正です");
  const sources = o["sources"] as unknown[];
  sources.forEach(validateSource);
  // 相互参照検証(レビュー再現: activeSourceId:"DOES_NOT_EXIST" で
  // App.tsx の `state.project.sources.find(...)!` が undefined を non-null 表明して
  // TypeError になる)。validateSource が既に各要素の source.id を string と確認済み
  // なのでここでは安全に集合化できる。
  const sourceIds = new Set(
    sources.map((s) => ((s as Record<string, unknown>)["source"] as Record<string, unknown>)["id"]),
  );
  if (!sourceIds.has(o["activeSourceId"])) {
    throw new Error(".bmk の activeSourceId が sources に存在しません");
  }
  const ui = o["ui"] as Record<string, unknown> | undefined;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) throw new Error(".bmk の ui が不正です");
  const fps = ui["fps"] as Record<string, unknown> | undefined;
  if (!fps || !isInt(fps["num"]) || !isInt(fps["den"]) || (fps["num"] as number) <= 0 || (fps["den"] as number) <= 0) {
    throw new Error(".bmk の ui.fps が不正です");
  }
  if (ui["rounding"] !== "nearest" && ui["rounding"] !== "floor") throw new Error(".bmk の ui.rounding が不正です");
  return raw as ProjectFileState;
}

export async function saveProjectTo(state: ProjectFileState, path: string): Promise<string> {
  const p = path.endsWith(".bmk") ? path : `${path}.bmk`;
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, JSON.stringify(state), "utf-8");
    await rename(tmp, p);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  return p;
}

export async function openProjectFrom(
  path: string,
): Promise<{ path: string; state: ProjectFileState }> {
  const text = await readFile(path, "utf-8");
  const state = validateProjectFile(JSON.parse(text));
  return { path, state };
}
