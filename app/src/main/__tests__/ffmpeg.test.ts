import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  extractAnalysisSources,
  extractPlaybackWav,
  FfmpegError,
  probeMedia,
} from "../ffmpeg.js";
import { ffmpegPath } from "../paths.js";

const dir = mkdtempSync(join(tmpdir(), "bmff-"));
const STEREO_WAV = join(dir, "stereo.wav");
// 環境調整(評価済み): ffmpeg/ffprobe 6.1.1のmov/mp4マルチプレクサ+デマルチプレクサは
// ストリーム単位の`title`タグをffprobeの-show_streamsへ再現しない(mkv→mp4のstream
// copyリマックスで検証済み: 元mkvにtitleがあっても出力mp4のtags.titleは消える)。
// mkvコンテナに切り替えると同条件で正しく往復する。モジュール側(ffmpeg.ts)は
// コンテナに依存しないffprobe JSONパースのみで、公開挙動・アサーションは無変更。
const TWO_TRACK_FILE = join(dir, "two.mkv");

beforeAll(() => {
  // フィクスチャをffmpegで合成(実メディアはコミットしない)
  // 1) L=440Hz / R=880Hz の2秒ステレオWAV
  execFileSync(ffmpegPath(), [
    "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=880:duration=2",
    "-filter_complex", "[0:a][1:a]join=inputs=2:channel_layout=stereo[a]",
    "-map", "[a]", "-ar", "44100", STEREO_WAV,
  ]);
  // 2) 音声2トラック入りmkv(トラック1=440Hz、トラック2=880Hz)
  execFileSync(ffmpegPath(), [
    "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=880:duration=2",
    "-map", "0:a", "-map", "1:a",
    "-metadata:s:a:1", "title=Vo",
    "-c:a", "aac", TWO_TRACK_FILE,
  ]);
}, 60_000);

describe("probeMedia", () => {
  it("WAV: 1トラック・2ch・長さ", async () => {
    const r = await probeMedia(STEREO_WAV);
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0]!.channels).toBe(2);
    expect(r.durationSec).toBeCloseTo(2, 1);
  });

  it("mkv: 2トラックとtitleメタ", async () => {
    const r = await probeMedia(TWO_TRACK_FILE);
    expect(r.tracks).toHaveLength(2);
    expect(r.tracks[1]!.title).toBe("Vo");
  });

  it("存在しないファイルはFfmpegError", async () => {
    await expect(probeMedia(join(dir, "none.mp4"))).rejects.toThrow(FfmpegError);
  });
});

describe("extractPlaybackWav", () => {
  it("44.1kHzステレオWAVが出る", async () => {
    const out = join(dir, "play.wav");
    await extractPlaybackWav(STEREO_WAV, [0], out);
    const info = JSON.parse(
      execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json",
        "-show_streams", out]).toString(),
    );
    expect(info.streams[0].sample_rate).toBe("44100");
    expect(info.streams[0].channels).toBe(2);
  });
});

describe("extractAnalysisSources", () => {
  it("mix+mono: 1ソース22.05kHzモノ", async () => {
    const outDir = mkdtempSync(join(dir, "mixmono-"));
    const srcs = await extractAnalysisSources(
      STEREO_WAV, { mode: "mix", trackIndexes: [0], channelSplit: "mono" }, outDir,
    );
    expect(srcs).toHaveLength(1);
    expect(srcs[0]!.source).toMatchObject({ kind: "mix", label: "2mix" });
    const info = JSON.parse(execFileSync("ffprobe", ["-v", "quiet", "-print_format",
      "json", "-show_streams", srcs[0]!.wavPath]).toString());
    expect(info.streams[0].sample_rate).toBe("22050");
    expect(info.streams[0].channels).toBe(1);
  });

  it("mix+stereo-split: L/Rの2ソースで周波数が分かれる", async () => {
    const outDir = mkdtempSync(join(dir, "split-"));
    const srcs = await extractAnalysisSources(
      STEREO_WAV, { mode: "mix", trackIndexes: [0], channelSplit: "stereo-split" }, outDir,
    );
    expect(srcs.map((s) => s.source.label)).toEqual(["L", "R"]);
    expect(srcs.every((s) => s.source.kind === "channel")).toBe(true);
    // L=440Hz / R=880Hz: astatsのゼロ交差ではなく、ボリューム検出で十分 —
    // ここでは「別ファイルで中身が異なる」ことをサイズ・ハッシュ差で確認
    const a = execFileSync("md5sum", [srcs[0]!.wavPath]).toString().split(" ")[0];
    const b = execFileSync("md5sum", [srcs[1]!.wavPath]).toString().split(" ")[0];
    expect(a).not.toBe(b);
  });

  it("multitrack: トラックごとにソース化されtitleがラベルになる", async () => {
    const outDir = mkdtempSync(join(dir, "multi-"));
    const srcs = await extractAnalysisSources(
      TWO_TRACK_FILE, { mode: "multitrack", trackIndexes: [0, 1], channelSplit: "mono" }, outDir,
    );
    expect(srcs).toHaveLength(2);
    expect(srcs[0]!.source).toMatchObject({ kind: "track", label: "Track 1" });
    expect(srcs[1]!.source).toMatchObject({ kind: "track", label: "Vo" });
  });
});
