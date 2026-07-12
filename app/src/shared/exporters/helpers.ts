/** エクスポータ共通部品。すべて純関数。 */
import type { Marker, MarkerType } from "../types.js";

export function selectMarkers(markers: Marker[], include: MarkerType[]): Marker[] {
  const set = new Set(include);
  return markers.filter((m) => set.has(m.type));
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** ExtendScript(ES3)の '...' / "..." リテラルに安全に埋め込める形へ。
 *  非ASCIIは \uXXXX にする(.jsx ファイルのエンコーディング解釈差を回避)。 */
export function escapeJsString(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === "'") out += "\\'";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code > 0x7e) {
      if (code > 0xffff) { // サロゲートペア
        const h = Math.floor((code - 0x10000) / 0x400) + 0xd800;
        const l = ((code - 0x10000) % 0x400) + 0xdc00;
        out += `\\u${h.toString(16).padStart(4, "0")}\\u${l.toString(16).padStart(4, "0")}`;
      } else {
        out += `\\u${code.toString(16).padStart(4, "0")}`;
      }
    } else out += ch;
  }
  return out;
}

export function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function padLeft(n: number, width: number): string {
  return String(n).padStart(width, "0");
}
