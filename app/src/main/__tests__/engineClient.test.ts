import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { EngineClient, EngineCrashError, EngineError } from "../engineClient.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, "fake-engine.cjs");
const REPO = join(HERE, "..", "..", "..", "..");
const VENV_PY = join(REPO, "engine", ".venv", "bin", "python");

function fakeClient(scenario: string): EngineClient {
  return new EngineClient({ cmd: process.execPath, args: [FAKE, scenario] });
}

let clients: EngineClient[] = [];
function track<T extends EngineClient>(c: T): T { clients.push(c); return c; }
afterEach(async () => {
  for (const c of clients) await c.dispose().catch(() => {});
  clients = [];
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
