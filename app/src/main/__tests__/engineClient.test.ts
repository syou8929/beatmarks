import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngineClient, EngineCrashError, EngineError } from "../engineClient.js";

// spawnを実装は本物のまま(vi.fn(actual.spawn)で素通し)スパイする。
// 「呼ばれた/呼ばれなかった」を確認するテスト(cancelCurrent/dispose後のno-op検証)のため。
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, "fake-engine.cjs");
const REPO = join(HERE, "..", "..", "..", "..");
const VENV_PY = join(REPO, "engine", ".venv", "bin", "python");
const NONEXISTENT_CMD = "/definitely/does/not/exist/beatmarks-engine-xyz";

function fakeClient(scenario: string): EngineClient {
  return new EngineClient({ cmd: process.execPath, args: [FAKE, scenario] });
}

let clients: EngineClient[] = [];
function track<T extends EngineClient>(c: T): T { clients.push(c); return c; }
afterEach(async () => {
  for (const c of clients) await c.dispose().catch(() => {});
  clients = [];
});

beforeEach(() => {
  vi.mocked(spawn).mockClear();
});

describe("EngineClient(偽エンジン)", () => {
  it("analyzeが結果を返し、進捗が届く", async () => {
    const c = track(fakeClient("normal"));
    const stages: string[] = [];
    const r = await c.analyze("/tmp/a.wav", (ev) => stages.push(ev.stage));
    expect((r.analysis as unknown as { fake: boolean }).fake).toBe(true);
    expect(stages).toContain("done");
  });

  it("直列化: 2つ同時に呼んでも順に処理される", async () => {
    const c = track(fakeClient("normal"));
    const [r1, r2] = await Promise.all([c.analyze("/tmp/1.wav"), c.analyze("/tmp/2.wav")]);
    expect((r1.analysis as unknown as { path: string }).path).toBe("/tmp/1.wav");
    expect((r2.analysis as unknown as { path: string }).path).toBe("/tmp/2.wav");
  });

  it("busy(-32002)は自動リトライされる", async () => {
    const c = track(fakeClient("busy-once"));
    const r = await c.analyze("/tmp/b.wav");
    expect((r.analysis as unknown as { fake: boolean }).fake).toBe(true);
  });

  it("実行中クラッシュはEngineCrashErrorになり、プロセスは再スポーンされる", async () => {
    const c = track(fakeClient("crash-mid"));
    await expect(c.analyze("/tmp/c.wav")).rejects.toThrow(EngineCrashError);
    // 再スポーンの確認は ping で行う(crash-midシナリオでもpingには応答する)
    await expect(c.ping()).resolves.toBe("pong");
  });
});

describe("EngineClient(実エンジン統合)", () => {
  it.skipIf(!existsSync(VENV_PY))("実エンジンで8秒クリックを解析できる", async () => {
    const wav = join(mkdtempSync(join(tmpdir(), "bmeng-")), "click.wav");
    execFileSync(VENV_PY, ["-c", `
import sys; sys.path.insert(0, ${JSON.stringify(join(REPO, "engine", "tests"))})
from synth import click_track, write_wav
y, _ = click_track(120.0, 8.0)
write_wav(${JSON.stringify(wav)}, y)
`]);
    const c = track(new EngineClient({
      cmd: VENV_PY, args: ["-m", "beatmarks_engine"], cwd: join(REPO, "engine"),
    }));
    const stages: string[] = [];
    const r = await c.analyze(wav, (ev) => stages.push(ev.stage));
    expect(Math.abs(r.analysis.durationSec - 8)).toBeLessThan(0.1);
    expect(stages[0]).toBe("load");
    expect(stages[stages.length - 1]).toBe("done");
  }, 120_000);
});

// --- レビュー対応: 以下は97e6bdd(feat: EngineClient初版)へのレビュー指摘に
// 対応するために追加したテスト群。 ---

describe("EngineClient(spawn失敗)", () => {
  // fix1: spawn自体が失敗する(コマンドのENOENT等)と、Node は 'exit' ではなく
  // 'error' のみを発火する('exit' は発火しない)。'error' リスナーが無いと
  // unhandled 'error' でプロセス全体が落ちる。以下のテストが完走すること自体が
  // 「メインプロセス(=このテストランナー)を落とさない」ことの実地証明になる:
  // もし修正前のコードのように unhandled 'error' が発生していれば、vitest の
  // ワーカープロセスごと落ちてこのファイルの以降のテスト・報告自体が失われる。
  it("spawn失敗(ENOENT)はEngineCrashErrorとしてping()をrejectし、メッセージに元エラーを含む", async () => {
    const c = track(new EngineClient({ cmd: NONEXISTENT_CMD, args: [] }));
    let caught: unknown;
    try {
      await c.ping();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EngineCrashError);
    expect((caught as Error).message).toMatch(/engine process failed to start/);
    expect((caught as Error).message).toMatch(/ENOENT/);
  });

  it("spawn失敗(ENOENT)はanalyze()もEngineCrashErrorでrejectし、繰り返し呼んでもハングしない", async () => {
    const c = track(new EngineClient({ cmd: NONEXISTENT_CMD, args: [] }));
    await expect(c.analyze("/tmp/x.wav")).rejects.toBeInstanceOf(EngineCrashError);
    // 1回目の失敗でthis.procがnullに戻り、2回目呼び出しは新規spawnを試みて
    // 同様に(状態が壊れて無限pendingにならずに)失敗すること。
    await expect(c.analyze("/tmp/y.wav")).rejects.toBeInstanceOf(EngineCrashError);
  });
});

describe("EngineClient(クラッシュ→再スポーンの複数サイクル)", () => {
  // fix2: 「置き換え済みの旧プロセスに対する遅延ハンドラが新プロセスの状態を
  // 巻き添えにしない」という不変条件がこの修正の核心だが、真のOS実行タイミング
  // レース(ensureProc()が新プロセスへ置き換えた直後に旧プロセスのexit/errorが
  // 遅れて発火する状況)を単体テストで決定的に強制するクリーンな方法が無かった
  // (実測で調査した内容はレポート参照)。代わりに、クラッシュ→再スポーンを
  // 複数サイクル連続させ、handleProcDeath()のガード導入が通常の(競合しない)
  // 経路を壊していないことを確認する回帰テストを用意する。
  it("クラッシュ→再スポーンを複数回連続させても状態が壊れない", async () => {
    const c = track(fakeClient("crash-mid"));
    for (let i = 0; i < 3; i++) {
      await expect(c.analyze(`/tmp/cycle-${i}.wav`)).rejects.toThrow(EngineCrashError);
      await expect(c.ping()).resolves.toBe("pong");
    }
  });
});

describe("EngineClient(cancelCurrent)", () => {
  it("実行中のanalyzeをcancelCurrentで中断できる(-32800でreject)", async () => {
    const c = track(fakeClient("slow-cancel"));
    let resolveLoaded!: () => void;
    const loaded = new Promise<void>((resolve) => { resolveLoaded = resolve; });
    const analyzeP = c.analyze("/tmp/slow.wav", (ev) => {
      if (ev.stage === "load") resolveLoaded();
    });
    await loaded; // analyzeの実リクエストが送信・受理されたことを確認してからcancel
    await expect(c.cancelCurrent()).resolves.toBeUndefined();

    let caught: unknown;
    try {
      await analyzeP;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EngineError);
    expect((caught as EngineError).code).toBe(-32800);
  });

  it("実行中ジョブが無ければno-opで、新規プロセスをspawnしない", async () => {
    const c = track(fakeClient("normal"));
    await expect(c.cancelCurrent()).resolves.toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
    // 対照: 通常のリクエストは従来通りspawnする(no-op経路だけが特別扱いされていることの確認)
    await c.ping();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("cancelCurrentは、より小さいidのpingが同時に飛んでいても実行中analyzeを対象にする", async () => {
    // 修正前のバグ再現条件: analyze()はキュー経由(1tick遅れ)でリクエストを送信する
    // ため、その直後に同期呼び出ししたping()の方が先にidを取得し、idが小さくなる。
    // 「pendingの最小id」を対象にする実装だとcancelがpingを対象にしてしまい、
    // analyzeは中断されない(エンジンはjobId不一致でcancelled:falseを返すのみ)。
    const c = track(fakeClient("slow-cancel"));
    const analyzeP = c.analyze("/tmp/slow.wav");
    const pingP = c.ping();
    await Promise.resolve(); // キューのthen()を1tick進め、analyzeの実リクエストを送信させる
    await c.cancelCurrent();

    let caught: unknown;
    try {
      await analyzeP;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EngineError);
    expect((caught as EngineError).code).toBe(-32800);
    await expect(pingP).resolves.toBe("pong");
  });
});

describe("EngineClient(dispose後)", () => {
  it("一度もspawnせずにdisposeした場合、以後のpingは新規プロセスをspawnせずrejectする", async () => {
    const c = track(fakeClient("normal"));
    await c.dispose(); // spawn前にdispose(何もしない)
    vi.mocked(spawn).mockClear();
    await expect(c.ping()).rejects.toThrow(/disposed/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawn済みの状態からdisposeすると、以後のpingは再スポーンせずrejectする", async () => {
    const c = track(fakeClient("normal"));
    await c.ping(); // spawnさせる
    await c.dispose();
    vi.mocked(spawn).mockClear();
    await expect(c.ping()).rejects.toThrow(/disposed/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("dispose後のcancelCurrentもrejectする", async () => {
    const c = track(fakeClient("normal"));
    await c.dispose();
    await expect(c.cancelCurrent()).rejects.toThrow(/disposed/i);
  });

  it("dispose後のanalyzeも(従来通り)rejectする", async () => {
    const c = track(fakeClient("normal"));
    await c.dispose();
    await expect(c.analyze("/tmp/x.wav")).rejects.toThrow(/disposed/i);
  });
});

describe("EngineClient(エラークラス)", () => {
  it("EngineError/EngineCrashErrorのnameがクラス名と一致する(FfmpegErrorと同じ規約)", () => {
    expect(new EngineError(-32001, "x").name).toBe("EngineError");
    expect(new EngineCrashError("x").name).toBe("EngineCrashError");
  });
});
