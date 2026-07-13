/** D&D後の解析オーケストレーション(スペック §4 データフロー 1-3)。
 *  ffmpeg抽出 → ソースごとにエンジン解析(直列)→ AnalyzedProject。 */
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";

import type { AnalyzedProject, AnalyzeProgressEvent, AnalyzeRequest } from "../shared/ipc.js";
import type { EngineClient } from "./engineClient.js";
import { extractAnalysisSources, extractPlaybackWav, probeMedia } from "./ffmpeg.js";
import { tempDir } from "./paths.js";

export class AnalyzeCancelledError extends Error {}

export interface AnalyzerDeps {
  engine: Pick<EngineClient, "analyze" | "cancelCurrent">;
  emitProgress: (ev: AnalyzeProgressEvent) => void;
}

export function createAnalyzer(deps: AnalyzerDeps): {
  analyzeMedia(req: AnalyzeRequest): Promise<AnalyzedProject>;
  cancel(): Promise<void>;
} {
  let cancelled = false;

  async function cancel(): Promise<void> {
    cancelled = true;
    await deps.engine.cancelCurrent();
  }

  function checkCancelled(): void {
    if (cancelled) throw new AnalyzeCancelledError("解析がキャンセルされました");
  }

  async function analyzeMedia(req: AnalyzeRequest): Promise<AnalyzedProject> {
    cancelled = false;
    const probe = await probeMedia(req.filePath);
    const jobDir = join(tempDir(), `job-${Date.now()}`);
    mkdirSync(jobDir, { recursive: true });

    // 再生用WAV
    const playbackWavPath = join(jobDir, "playback.wav");
    await extractPlaybackWav(req.filePath, req.input.trackIndexes, playbackWavPath);
    checkCancelled();

    // 解析ソース抽出
    const extracted = await extractAnalysisSources(req.filePath, req.input, jobDir);
    checkCancelled();

    const sources: AnalyzedProject["sources"] = [];
    for (let i = 0; i < extracted.length; i++) {
      const { source, wavPath } = extracted[i]!;
      const base: Omit<AnalyzeProgressEvent, "stage" | "percent"> = {
        sourceLabel: source.label,
        sourceIndex: i,
        sourceCount: extracted.length,
      };
      deps.emitProgress({ ...base, stage: "extract", percent: 0 });
      checkCancelled();
      const { analysis, warnings } = await deps.engine.analyze(wavPath, (ev) =>
        deps.emitProgress({ ...base, stage: ev.stage, percent: ev.percent }),
      );
      checkCancelled();
      sources.push({ source, analysis, warnings, analysisWavPath: wavPath });
    }

    const mediaHash = createHash("sha256").update(readFileSync(playbackWavPath)).digest("hex");
    return {
      mediaPath: req.filePath,
      mediaHash,
      baseName: basename(req.filePath, extname(req.filePath)),
      playbackWavPath,
      durationSec: probe.durationSec,
      sources,
    };
  }

  return { analyzeMedia, cancel };
}
