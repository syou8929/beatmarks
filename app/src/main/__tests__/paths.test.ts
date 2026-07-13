import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanupTempDir, engineCommand, isPathWithinRoots, tempDir } from "../paths.js";

// engineCommand()はnode:fsのexistsSyncを直接呼ぶため、venvが実在するこの
// チェックアウトでも「venv無し」分岐をモックで(実ファイルシステムに触れずに)再現する。
// 素通し実装(vi.fn(actual.existsSync))で包むので、上書きしない限り実際の
// ファイルシステムを見る通常の動作のまま。
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

describe("engineCommand()", () => {
  const ORIGINAL_ENV = process.env["BEATMARKS_ENGINE"];

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env["BEATMARKS_ENGINE"];
    else process.env["BEATMARKS_ENGINE"] = ORIGINAL_ENV;
    vi.mocked(existsSync).mockClear();
  });

  it("BEATMARKS_ENGINE が設定されていればそれをcmdとして返す(args空・venv探索なし)", () => {
    process.env["BEATMARKS_ENGINE"] = "/opt/custom/beatmarks-engine";
    expect(engineCommand()).toEqual({ cmd: "/opt/custom/beatmarks-engine", args: [] });
    expect(existsSync).not.toHaveBeenCalled();
  });

  it("BEATMARKS_ENGINE未設定かつvenvも無ければエラーを投げる", () => {
    delete process.env["BEATMARKS_ENGINE"];
    vi.mocked(existsSync).mockReturnValueOnce(false);
    expect(() => engineCommand()).toThrow(/エンジンが見つかりません/);
  });
});

// main/index.ts の実配線(Task 6)で tempDir()/cleanupTempDir() が実際に使われるように
// なったため、それまで未検証だった生成・キャッシュ・削除の挙動をここで確認する
// (計画doc App Task 3/5 の申し送り: 「paths.tempDir系テストはindex.ts配線時に追加」)。
describe("tempDir() / cleanupTempDir()", () => {
  afterEach(() => {
    cleanupTempDir(); // 前のテストが作った一時ディレクトリを毎回後始末する(存在しなければ no-op)
  });

  it("ディレクトリを作成し、同一プロセス内では同じパスをキャッシュして返す", () => {
    const p1 = tempDir();
    expect(existsSync(p1)).toBe(true);
    expect(tempDir()).toBe(p1);
  });

  it("cleanupTempDir()は作成済みの一時ディレクトリを削除し、キャッシュをリセットする", () => {
    const p = tempDir();
    expect(existsSync(p)).toBe(true);
    cleanupTempDir();
    expect(existsSync(p)).toBe(false);
    // リセット後の呼び出しは新しいディレクトリを作る(キャッシュが空になっている)
    const p2 = tempDir();
    expect(existsSync(p2)).toBe(true);
  });
});

// readFileBytes の許可判定(Task 6レビュー: 素朴な startsWith 実装は正規化なしで
// `<root>/../../etc/passwd` のようなトラバーサルや `<root>-evil` のような裸の
// プレフィックス一致を通してしまっていた)。ここでは実ファイルシステムに触れず、
// resolve()ベースの正規化だけを検証する。
describe("isPathWithinRoots()", () => {
  const dirRoot = resolve("/tmp/bm-roots-test/media");
  const fileRoot = resolve("/tmp/bm-roots-test/media/file.wav");

  it("ディレクトリrootの子(直下)はtrue", () => {
    expect(isPathWithinRoots(join(dirRoot, "child.wav"), [dirRoot])).toBe(true);
  });

  it("`..`でrootの外に出るパスはfalse(トラバーサル拒否)", () => {
    const outside = join(dirRoot, "..", "x");
    expect(isPathWithinRoots(outside, [dirRoot])).toBe(false);
  });

  it("root配下に留まる`..`はtrue(正規化後にroot内)", () => {
    const staysInside = join(dirRoot, "sub", "..", "file.wav");
    expect(isPathWithinRoots(staysInside, [dirRoot])).toBe(true);
  });

  it("ファイルrootとの完全一致はtrue", () => {
    expect(isPathWithinRoots(fileRoot, [fileRoot])).toBe(true);
  });

  it("ファイルrootの裸のプレフィックス一致(sep区切りなし)はfalse", () => {
    expect(isPathWithinRoots(`${fileRoot}.evil`, [fileRoot])).toBe(false);
  });

  it("複数rootのいずれかに一致すればtrue、どれにも一致しなければfalse", () => {
    const otherRoot = resolve("/tmp/bm-roots-test/other");
    const roots = new Set([dirRoot, otherRoot]);
    expect(isPathWithinRoots(join(otherRoot, "y.wav"), roots)).toBe(true);
    expect(isPathWithinRoots(resolve("/tmp/unrelated"), roots)).toBe(false);
  });
});
