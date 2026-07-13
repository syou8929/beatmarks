/** 外部バイナリと一時ディレクトリのパス解決。パッケージ時の同梱切替(計画③b)は
 *  ここだけを変更すればよいように一元化する。 */
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function ffmpegPath(): string {
  return process.env["BEATMARKS_FFMPEG"] ?? "ffmpeg";
}

export function ffprobePath(): string {
  return process.env["BEATMARKS_FFPROBE"] ?? "ffprobe";
}

let cachedTemp: string | null = null;

export function tempDir(): string {
  if (!cachedTemp) {
    cachedTemp = join(tmpdir(), "beatmarks", `${process.pid}-${process.hrtime.bigint()}`);
    mkdirSync(cachedTemp, { recursive: true });
  }
  return cachedTemp;
}

export function cleanupTempDir(): void {
  if (cachedTemp) {
    rmSync(cachedTemp, { recursive: true, force: true });
    cachedTemp = null;
  }
}
