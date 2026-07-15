/** EditorProject → .bmk 永続形(ProjectFileState)。保存と書き出しで共用。 */
import type { ProjectFileState } from "../../shared/ipc.js";
import type { EditorProject } from "./store.js";

export function toProjectFileState(p: EditorProject): ProjectFileState {
  return {
    version: 1,
    mediaPath: p.mediaPath, mediaHash: p.mediaHash, baseName: p.baseName,
    playbackWavPath: p.playbackWavPath, durationSec: p.durationSec,
    sources: p.sources.map((s) => ({ source: s.source, analysis: s.analysis, edits: s.edits })),
    activeSourceId: p.activeSourceId,
    ui: { fps: p.fps, rounding: p.rounding },
  };
}
