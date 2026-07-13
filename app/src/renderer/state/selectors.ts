/** deriveGrid/deriveMarkers のメモ化セレクタ。analysis/edits の参照同一性でキャッシュ。 */
import { barsOf, deriveGrid, type GridBeat } from "../../shared/deriveGrid.js";
import { deriveMarkers } from "../../shared/deriveMarkers.js";
import type { AnalysisResult, EditState, Marker } from "../../shared/types.js";
import type { AppState } from "./store.js";

interface CacheEntry<T> {
  analysis: AnalysisResult; edits: EditState; sourceId: string; value: T;
}

let markerCache: CacheEntry<Marker[]> | null = null;
let gridCache: CacheEntry<GridBeat[]> | null = null;

function active(state: AppState) {
  if (state.phase !== "editor") return null;
  const s = state.project.sources.find((x) => x.source.id === state.project.activeSourceId);
  return s ?? null;
}

export function selectMarkers(state: AppState): Marker[] {
  const s = active(state);
  if (!s) return [];
  if (
    markerCache &&
    markerCache.analysis === s.analysis &&
    markerCache.edits === s.edits &&
    markerCache.sourceId === s.source.id
  ) {
    return markerCache.value;
  }
  const value = deriveMarkers(s.analysis, s.edits, s.source.id);
  markerCache = { analysis: s.analysis, edits: s.edits, sourceId: s.source.id, value };
  return value;
}

export function selectGrid(state: AppState): GridBeat[] {
  const s = active(state);
  if (!s) return [];
  if (
    gridCache &&
    gridCache.analysis === s.analysis &&
    gridCache.edits === s.edits &&
    gridCache.sourceId === s.source.id
  ) {
    return gridCache.value;
  }
  const value = deriveGrid(s.analysis, s.edits);
  gridCache = { analysis: s.analysis, edits: s.edits, sourceId: s.source.id, value };
  return value;
}

export function selectBars(state: AppState): GridBeat[] {
  return barsOf(selectGrid(state));
}
