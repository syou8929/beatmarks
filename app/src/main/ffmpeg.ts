/** ffmpeg/ffprobe ラッパ(別プロセス実行 — LGPL方針準拠、スペック §4)。
 *  抽出仕様: 再生用 44.1kHz ステレオ / 解析用 22.05kHz モノ(スペック §4)。 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import type { InputConfig, ProbeResult, ProbeTrack } from "../shared/ipc.js";
import type { AudioSource } from "../shared/types.js";
import { ffmpegPath, ffprobePath } from "./paths.js";

const execFileP = promisify(execFile);

export class FfmpegError extends Error {}

async function run(bin: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP(bin, args, { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    const tail = (err.stderr ?? err.message).split("\n").slice(-6).join("\n");
    throw new FfmpegError(`${bin} failed: ${tail}`);
  }
}

interface FfprobeStream {
  index: number;
  codec_type: string;
  codec_name?: string;
  channels?: number;
  tags?: Record<string, string>;
}

export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const out = await run(ffprobePath(), [
    "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath,
  ]);
  const parsed = JSON.parse(out) as {
    streams?: FfprobeStream[];
    format?: { duration?: string };
  };
  const audio = (parsed.streams ?? []).filter((s) => s.codec_type === "audio");
  const tracks: ProbeTrack[] = audio.map((s, i) => ({
    index: i,
    codec: s.codec_name ?? "unknown",
    channels: s.channels ?? 0,
    language: s.tags?.["language"] ?? null,
    title: s.tags?.["title"] ?? null,
  }));
  const durationSec = Number(parsed.format?.duration ?? 0);
  if (tracks.length === 0) throw new FfmpegError("音声トラックが見つかりません");
  return { durationSec, tracks };
}

/** 選択audioトラック(0起点のaudio順)をffmpegの -map 指定に変換 */
function mapArgs(trackIndexes: number[]): string[] {
  return trackIndexes.flatMap((t) => ["-map", `0:a:${t}`]);
}

export async function extractPlaybackWav(
  filePath: string, trackIndexes: number[], outPath: string,
): Promise<void> {
  const args = ["-y", "-i", filePath];
  if (trackIndexes.length <= 1) {
    args.push("-map", `0:a:${trackIndexes[0] ?? 0}`);
  } else {
    const inputs = trackIndexes.map((t) => `[0:a:${t}]`).join("");
    args.push(
      "-filter_complex", `${inputs}amix=inputs=${trackIndexes.length}:normalize=1[a]`,
      "-map", "[a]",
    );
  }
  args.push("-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", outPath);
  await run(ffmpegPath(), args);
}

const ANALYSIS_ARGS = ["-ar", "22050", "-c:a", "pcm_s16le"];

export async function extractAnalysisSources(
  filePath: string, input: InputConfig, outDir: string,
): Promise<{ source: AudioSource; wavPath: string }[]> {
  const out: { source: AudioSource; wavPath: string }[] = [];

  if (input.mode === "multitrack") {
    for (const t of input.trackIndexes) {
      const wavPath = join(outDir, `src-track${t}.wav`);
      await run(ffmpegPath(), [
        "-y", "-i", filePath, "-map", `0:a:${t}`, "-ac", "1", ...ANALYSIS_ARGS, wavPath,
      ]);
      const probe = await probeMedia(filePath);
      const label = probe.tracks[t]?.title ?? `Track ${t + 1}`;
      out.push({ source: { id: `track-${t}`, kind: "track", label }, wavPath });
    }
    return out;
  }

  // mode: "mix"
  const mixInputs = input.trackIndexes.map((t) => `[0:a:${t}]`).join("");
  const mixFilter =
    input.trackIndexes.length > 1
      ? `${mixInputs}amix=inputs=${input.trackIndexes.length}:normalize=1[m]`
      : `[0:a:${input.trackIndexes[0] ?? 0}]anull[m]`;

  if (input.channelSplit === "mono") {
    const wavPath = join(outDir, "src-mix.wav");
    await run(ffmpegPath(), [
      "-y", "-i", filePath,
      "-filter_complex", mixFilter, "-map", "[m]", "-ac", "1", ...ANALYSIS_ARGS, wavPath,
    ]);
    out.push({ source: { id: "mix", kind: "mix", label: "2mix" }, wavPath });
    return out;
  }

  // stereo-split: L / R を個別ソースに(スペック §3.1)
  const lPath = join(outDir, "src-L.wav");
  const rPath = join(outDir, "src-R.wav");
  await run(ffmpegPath(), [
    "-y", "-i", filePath,
    "-filter_complex",
    `${mixFilter};[m]channelsplit=channel_layout=stereo[L][R]`,
    "-map", "[L]", ...ANALYSIS_ARGS, lPath,
    "-map", "[R]", ...ANALYSIS_ARGS, rPath,
  ]);
  out.push({ source: { id: "ch-L", kind: "channel", label: "L" }, wavPath: lPath });
  out.push({ source: { id: "ch-R", kind: "channel", label: "R" }, wavPath: rPath });
  return out;
}
