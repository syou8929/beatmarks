/** 解析+編集 → 最終マーカー列(単一ソース分)。エクスポータと UI が共有する唯一の導出点。 */
import { barsOf, deriveGrid } from "./deriveGrid.js";
import { detectSilencesFromEnvelope } from "./envelope.js";
import type { AnalysisResult, Band, EditState, Marker, SectionInfo } from "./types.js";

export const SECTION_COLORS = [
  "#5b7fd4", "#38a3a5", "#f4a259", "#e4547c",
  "#8d78d9", "#b56fd0", "#6b7686", "#4f8f6b",
] as const;
export const HIT_COLORS: Record<Band, string> = {
  low: "#ff7847", mid: "#ffd166", high: "#5ad1e6",
};
export const SILENCE_COLOR = "#6b7686";
export const BEAT_COLOR = "#8b94a3";
export const BAR_COLOR = "#e8ebf0";

const TYPE_ORDER: Record<Marker["type"], number> = {
  section: 0, bar: 1, beat: 2, hit: 3, silence: 4, custom: 5,
};

interface WorkingSection {
  startSec: number;
  label: string;
  color: string;
  renamed: boolean;
  chorusCandidate: boolean;
  deleted: boolean;
}

function applySectionEdits(analysis: AnalysisResult, edits: EditState): WorkingSection[] {
  const work: WorkingSection[] = analysis.sections.map((s: SectionInfo) => ({
    startSec: s.startSec,
    label: s.label,
    color: SECTION_COLORS[s.clusterId % SECTION_COLORS.length]!,
    renamed: false,
    chorusCandidate: s.chorusCandidate,
    deleted: false,
  }));
  for (const e of edits.sectionEdits) {
    if (e.op === "add") {
      work.push({
        startSec: e.startSec, label: e.label, color: e.color,
        renamed: true, chorusCandidate: false, deleted: false,
      });
      continue;
    }
    const target = work[e.index];
    if (!target) continue; // 不正indexは無視(UIのバグでも書き出しは壊さない)
    if (e.op === "move") target.startSec = e.startSec;
    else if (e.op === "rename") { target.label = e.label; target.renamed = true; }
    else if (e.op === "recolor") target.color = e.color;
    else if (e.op === "delete") target.deleted = true;
  }
  const alive = work.filter((w) => !w.deleted).sort((a, b) => a.startSec - b.startSec);
  if (alive.length > 0) alive[0]!.startSec = 0; // 先頭は常に曲頭
  return alive;
}

export function deriveMarkers(
  analysis: AnalysisResult, edits: EditState, sourceId: string,
): Marker[] {
  const out: Marker[] = [];
  const dur = analysis.durationSec;

  // beat / bar
  const grid = deriveGrid(analysis, edits);
  for (const b of grid) {
    if (b.free) continue;
    out.push({
      id: `beat-${b.index}`, sourceId, timeSec: b.timeSec, type: "beat",
      label: "拍", color: BEAT_COLOR, source: "auto",
    });
  }
  for (const b of barsOf(grid)) {
    out.push({
      id: `bar-${b.barNumber}`, sourceId, timeSec: b.timeSec, type: "bar",
      label: `小節${b.barNumber}`, color: BAR_COLOR, source: "auto",
      meta: { barNumber: b.barNumber },
    });
  }

  // section
  const sections = applySectionEdits(analysis, edits);
  sections.forEach((s, i) => {
    const end = i + 1 < sections.length ? sections[i + 1]!.startSec : dur;
    const label = s.chorusCandidate && !s.renamed ? `${s.label} ★` : s.label;
    out.push({
      id: `sec-${i}`, sourceId, timeSec: s.startSec, type: "section",
      label, color: s.color, source: "auto",
      meta: { durationSec: end - s.startSec },
    });
  });

  // hit(しきい値はUI側=ここで適用。スペック §3.2-5)
  analysis.hits.forEach((h, i) => {
    if (h.strength < edits.hitThreshold[h.band]) return;
    out.push({
      id: `hit-${h.band}-${i}`, sourceId, timeSec: h.timeSec, type: "hit",
      label: h.band, color: HIT_COLORS[h.band], source: "auto",
      meta: { strength: h.strength, band: h.band },
    });
  });

  // silence(envelopeから再導出。IN/OUTの2点。スペック §3.2-7)
  const silences = detectSilencesFromEnvelope(
    analysis.envelopes.total, analysis.envelopes.sampleRateHz,
    edits.silenceThreshold.db, edits.silenceThreshold.minDurSec,
  );
  silences.forEach((r, i) => {
    out.push({
      id: `sil-${i}-in`, sourceId, timeSec: r.startSec, type: "silence",
      label: "静寂IN", color: SILENCE_COLOR, source: "auto",
      meta: { durationSec: r.endSec - r.startSec },
    });
    out.push({
      id: `sil-${i}-out`, sourceId, timeSec: r.endSec, type: "silence",
      label: "静寂OUT", color: SILENCE_COLOR, source: "auto",
    });
  });

  // custom
  for (const c of edits.customMarkers) {
    out.push({ ...c, sourceId, source: "user" });
  }

  // 削除とソート
  const deleted = new Set(edits.deletedMarkerIds);
  return out
    .filter((m) => !deleted.has(m.id))
    .sort((a, b) => a.timeSec - b.timeSec || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
}
