/** エンジン(計画①)の子プロセス管理と JSON-RPC クライアント。
 *  - NDJSON 1行1メッセージ、id対応表で request/response を突き合わせ
 *  - progress notification は実行中ジョブの onProgress へ
 *  - 同時1ジョブ(アプリ側キュー)。busy(-32002)は再試行
 *  - 異常終了: 実行中ジョブを EngineCrashError で reject、次回 analyze で再スポーン
 *  - dispose(): 実行中ジョブ完了後に stdin を閉じてEOF終了(エンジンREADME契約) */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { AnalysisResult } from "../shared/types.js";

export class EngineError extends Error {
  constructor(public code: number, message: string) { super(message); }
}
export class EngineCrashError extends Error {}

export interface EngineProgress { stage: string; percent: number }

interface EngineSpawnSpec { cmd: string; args: string[]; cwd?: string }

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (ev: EngineProgress) => void;
}

const BUSY_RETRY_MS = 200;
const BUSY_RETRY_MAX = 5;

export class EngineClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(private spec: EngineSpawnSpec) {}

  private ensureProc(): ChildProcessWithoutNullStreams {
    if (this.proc && this.proc.exitCode === null) return this.proc;
    const p = spawn(this.spec.cmd, this.spec.args, {
      cwd: this.spec.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    p.stdout.setEncoding("utf-8");
    p.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this.onMessage(line);
      }
    });
    p.stderr.setEncoding("utf-8");
    p.stderr.on("data", () => { /* エンジンログ。計画③bでelectron-logへ */ });
    p.on("exit", () => {
      const crashed = new EngineCrashError("エンジンプロセスが終了しました");
      for (const [, pend] of this.pending) pend.reject(crashed);
      this.pending.clear();
      this.proc = null;
    });
    this.proc = p;
    return p;
  }

  private onMessage(line: string): void {
    let msg: {
      id?: number; result?: unknown; error?: { code: number; message: string };
      method?: string; params?: { jobId?: string; stage?: string; percent?: number };
    };
    try { msg = JSON.parse(line); } catch { return; }

    if (msg.method === "progress" && msg.params) {
      const jobId = Number(msg.params.jobId);
      const pend = this.pending.get(jobId);
      pend?.onProgress?.({
        stage: msg.params.stage ?? "?",
        percent: msg.params.percent ?? 0,
      });
      return;
    }
    if (msg.id === undefined) return;
    const pend = this.pending.get(msg.id);
    if (!pend) return;
    this.pending.delete(msg.id);
    if (msg.error) pend.reject(new EngineError(msg.error.code, msg.error.message));
    else pend.resolve(msg.result);
  }

  private request(
    method: string, params: unknown, onProgress?: (ev: EngineProgress) => void,
  ): Promise<unknown> {
    const p = this.ensureProc();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async ping(): Promise<string> {
    return (await this.request("ping", undefined)) as string;
  }

  private async analyzeOnce(
    audioPath: string, onProgress?: (ev: EngineProgress) => void,
  ): Promise<{ analysis: AnalysisResult; warnings: string[] }> {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = (await this.request("analyze", { audioPath }, onProgress)) as {
          analysis: AnalysisResult; warnings: string[];
        };
        return { analysis: r.analysis, warnings: r.warnings };
      } catch (e) {
        if (e instanceof EngineError && e.code === -32002 && attempt < BUSY_RETRY_MAX) {
          await new Promise((r) => setTimeout(r, BUSY_RETRY_MS));
          continue;
        }
        throw e;
      }
    }
  }

  analyze(
    audioPath: string, onProgress?: (ev: EngineProgress) => void,
  ): Promise<{ analysis: AnalysisResult; warnings: string[] }> {
    if (this.disposed) return Promise.reject(new Error("disposed"));
    const job = this.queue.then(() => this.analyzeOnce(audioPath, onProgress));
    this.queue = job.catch(() => {}); // 失敗してもキューは続行
    return job;
  }

  async cancelCurrent(): Promise<void> {
    // 実行中ジョブのid = pendingの最小id(analyzeは直列なので高々1つ+cancel自身)
    const ids = [...this.pending.keys()];
    if (ids.length === 0 || !this.proc) return;
    const jobId = String(Math.min(...ids));
    await this.request("cancel", { jobId }).catch(() => {});
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.queue.catch(() => {});
    const p = this.proc;
    if (!p) return;
    await new Promise<void>((resolve) => {
      p.once("exit", () => resolve());
      p.stdin.end();               // EOF → エンジンは残ジョブ排出後に終了(README契約)
      setTimeout(() => { p.kill(); resolve(); }, 3000).unref();
    });
    this.proc = null;
  }
}
