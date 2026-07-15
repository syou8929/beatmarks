/** .bmk 再オープンのオーケストレーション(spec §6)。playbackWav は永続化せず
 *  mediaPath から再抽出し、mediaHash で差し替えを検知する。fs/ffmpeg は deps 注入。
 *  trackIndexes は .bmk に永続化された ProjectFileState.input(台帳追加要件)から取る
 *  ため、複数トラックのミックス由来プロジェクトでも再抽出内容が元の選択と一致し、
 *  mediaHash 比較が意味のある差し替え検知になる(以前の [0] 固定は誤検知の温床だった)。 */
import { join } from "node:path";

import type { OpenProjectOutcome, ProjectFileState } from "../shared/ipc.js";

export interface OpenProjectDeps {
  readProject(path: string): Promise<ProjectFileState>;   // = openProjectFrom(path).state(deep validate 済み)
  exists(path: string): boolean;
  extractPlaybackWav(mediaPath: string, trackIndexes: number[], outPath: string): Promise<void>;
  hashFile(path: string): Promise<string>;
  jobDir(): string;
}

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

export async function openProjectFlow(path: string, deps: OpenProjectDeps): Promise<OpenProjectOutcome> {
  let state: ProjectFileState;
  try { state = await deps.readProject(path); }
  catch (e) { return { ok: false, message: `プロジェクトを開けません: ${msg(e)}` }; }
  if (!deps.exists(state.mediaPath)) {
    return { ok: false, message: `元メディアが見つかりません: ${state.mediaPath}` };
  }
  const outPath = join(deps.jobDir(), "playback.wav");
  try { await deps.extractPlaybackWav(state.mediaPath, state.input.trackIndexes, outPath); }
  catch (e) { return { ok: false, message: `音声の再抽出に失敗しました: ${msg(e)}` }; }
  const hashMismatch = (await deps.hashFile(outPath)) !== state.mediaHash;
  return { ok: true, path, state, playbackWavPath: outPath, hashMismatch };
}
