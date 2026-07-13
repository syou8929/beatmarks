/** D&D後の解析オーケストレーション(スペック §4 データフロー 1-3)。
 *  ffmpeg抽出 → ソースごとにエンジン解析(直列)→ AnalyzedProject。 */
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";

import type { AnalyzedProject, AnalyzeProgressEvent, AnalyzeRequest } from "../shared/ipc.js";
import { EngineError, type EngineClient } from "./engineClient.js";
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
  // 1インスタンス=同時1ジョブ。cancelled フラグと jobDir 名は並行呼び出しを想定しない。
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
    // jobDir はエラー/キャンセル時も削除しない(呼び出し側が paths.cleanupTempDir() で
    // アプリ終了時に一括回収する。ffmpeg.ts の extractPlaybackWav/extractAnalysisSources と同じ方針)。
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
      let result: Awaited<ReturnType<AnalyzerDeps["engine"]["analyze"]>>;
      try {
        result = await deps.engine.analyze(wavPath, (ev) =>
          deps.emitProgress({ ...base, stage: ev.stage, percent: ev.percent }),
        );
      } catch (e) {
        // cancel()はcancelCurrent()のACKを待つだけだが、実際にin-flightのanalyze
        // リクエストが決着するのはその後: エンジンがEngineError(code -32800)で
        // rejectする(engineClient.tsの実挙動、engineClient.test.ts参照)。ここで
        // 変換しないと生のEngineErrorが漏れ、ドキュメント上の契約(キャンセル時は
        // AnalyzeCancelledError)を破ってしまう。
        if (cancelled || (e instanceof EngineError && e.code === -32800)) {
          throw new AnalyzeCancelledError("解析がキャンセルされました");
        }
        throw e;
      }
      checkCancelled();
      const { analysis, warnings } = result;
      sources.push({ source, analysis, warnings, analysisWavPath: wavPath });
    }

    // 再生用WAV(1時間ミックスで~635MB、スペック§12)をメインプロセスをブロック
    // せずにハッシュ化するため、全読み込みではなくストリーミングで処理する。
    const hash = createHash("sha256");
    await pipeline(createReadStream(playbackWavPath), hash);
    const mediaHash = hash.digest("hex");
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
