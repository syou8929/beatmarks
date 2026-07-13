import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { engineCommand } from "../paths.js";

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
