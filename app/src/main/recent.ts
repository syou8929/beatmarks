/** 最近使ったファイル(userData/recent.json、最大5件)。新規依存なしの素の JSON。 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MAX = 5;

export function recentPath(userDataDir: string): string { return join(userDataDir, "recent.json"); }

export function loadRecent(userDataDir: string): string[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(recentPath(userDataDir), "utf-8"));
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch { return []; }
}

export function addRecent(userDataDir: string, path: string): string[] {
  const next = [path, ...loadRecent(userDataDir).filter((p) => p !== path)].slice(0, MAX);
  const file = recentPath(userDataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next), "utf-8");
  return next;
}
