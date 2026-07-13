/** .bmk(実体はJSON)の保存/読込(スペック §3.5, §6)。dialogはmain/index.tsで注入。 */
import { readFile, rename, unlink, writeFile } from "node:fs/promises";

import type { ProjectFileState } from "../shared/ipc.js";

export function validateProjectFile(raw: unknown): ProjectFileState {
  if (typeof raw !== "object" || raw === null) throw new Error(".bmk の形式が不正です");
  const o = raw as Record<string, unknown>;
  if (o["version"] !== 1) {
    throw new Error(`未対応の .bmk version: ${String(o["version"])}(対応: 1)`);
  }
  for (const key of [
    "mediaPath", "mediaHash", "baseName", "playbackWavPath", "activeSourceId",
  ]) {
    if (typeof o[key] !== "string") throw new Error(`.bmk の ${key} が不正です`);
  }
  if (typeof o["durationSec"] !== "number") throw new Error(".bmk の durationSec が不正です");
  if (!Array.isArray(o["sources"])) throw new Error(".bmk の sources が不正です");
  if (typeof o["ui"] !== "object" || o["ui"] === null || Array.isArray(o["ui"])) {
    throw new Error(".bmk の ui が不正です");
  }
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
