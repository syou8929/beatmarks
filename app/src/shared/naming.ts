/** 書き出しターゲット表と出力ファイル命名(スペック §8)。
 *  略称の決め方: 通称で通じる最短形。ただし他ツールと紛らわしいものはフル名寄り
 *  (3dsMax を Max としない、Premiere は PPro)。Phase 2 でカスタマイズ可能にする。 */
export type TargetKey =
  | "json" | "csv" | "midi"
  | "aejsx" | "premiere" | "resolve" | "blender"
  | "wavcues" | "reaper" | "nuendo" | "audacity";

export const TARGETS: Record<TargetKey, { label: string; abbr: string; ext: string }> = {
  json: { label: "JSON (正規形式)", abbr: "markers", ext: "json" },
  csv: { label: "CSV", abbr: "markers", ext: "csv" },
  midi: { label: "MIDI", abbr: "markers", ext: "mid" },
  aejsx: { label: "After Effects", abbr: "AE", ext: "jsx" },
  premiere: { label: "Premiere Pro", abbr: "PPro", ext: "xml" },
  resolve: { label: "DaVinci Resolve", abbr: "Resolve", ext: "edl" },
  blender: { label: "Blender", abbr: "Blender", ext: "py" },
  wavcues: { label: "WAV (キュー埋め込み)", abbr: "cues", ext: "wav" },
  reaper: { label: "REAPER", abbr: "REAPER", ext: "csv" },
  nuendo: { label: "Nuendo / Cubase", abbr: "Nuendo", ext: "csv" },
  audacity: { label: "Audacity", abbr: "Audacity", ext: "txt" },
};

function sanitize(part: string): string {
  return part.replace(/[\\/:*?"<>|\s]+/g, "-");
}

export function buildFileName(
  baseName: string, sourceLabel: string | null, target: TargetKey,
): string {
  const t = TARGETS[target];
  const src = sourceLabel ? `_${sanitize(sourceLabel)}` : "";
  return `${sanitize(baseName)}${src}_${t.abbr}.${t.ext}`;
}
