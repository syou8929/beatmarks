/** 外部バイナリと一時ディレクトリのパス解決。パッケージ時の同梱切替(計画③b)は
 *  ここだけを変更すればよいように一元化する。 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
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

export function engineCommand(): { cmd: string; args: string[]; cwd?: string } {
  const bin = process.env["BEATMARKS_ENGINE"];
  if (bin) return { cmd: bin, args: [] };
  // 開発時: リポジトリのvenv(app/から見て ../engine)
  const repoEngine = join(__dirname, "..", "..", "..", "engine");
  const venvPy = join(repoEngine, ".venv", "bin", "python");
  if (existsSync(venvPy)) {
    return { cmd: venvPy, args: ["-m", "beatmarks_engine"], cwd: repoEngine };
  }
  throw new Error("エンジンが見つかりません(BEATMARKS_ENGINE を設定するか engine/.venv を用意)");
}
