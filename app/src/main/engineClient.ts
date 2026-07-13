/** エンジン(計画①)の子プロセス管理と JSON-RPC クライアント。
 *  - NDJSON 1行1メッセージ、id対応表で request/response を突き合わせ
 *  - progress notification は実行中ジョブの onProgress へ
 *  - 同時1ジョブ(アプリ側キュー)。busy(-32002)は再試行
 *  - 異常終了(exit)・起動失敗(error, 例: コマンドのENOENT)はどちらも
 *    handleProcDeath() に集約: 保留中の全リクエストを EngineCrashError で
 *    reject し、次回リクエストで再スポーンする
 *  - handleProcDeath() は対象プロセス(p)が this.proc と一致する時だけ状態を
 *    書き換える。ensureProc() が新プロセスへ置き換える際は旧プロセスの後始末を
 *    先に済ませるため、旧プロセスの遅延ハンドラが新プロセスを巻き添えにしない
 *  - dispose(): 実行中ジョブ完了後に stdin を閉じてEOF終了(エンジンREADME契約)。
 *    以後の ping/cancelCurrent/analyze は再スポーンせずエラーになる */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { AnalysisResult } from "../shared/types.js";

export class EngineError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = "EngineError";
  }
}
export class EngineCrashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineCrashError";
  }
}

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
  /** 実行中analyzeジョブのリクエストid(busyリトライのたびに更新)。cancelCurrent()の対象。
   *  analyzeはキューで直列化されるため高々1つ。ping/cancelCurrent自身のidはここに
   *  含めない: どちらもキューをバイパスする設計のため、"pendingの最小id" では
   *  対象の実行中analyzeジョブを正しく特定できない(旧実装のバグ)。 */
  private currentAnalyzeId: number | null = null;

  constructor(private spec: EngineSpawnSpec) {}

  private ensureProc(): ChildProcessWithoutNullStreams {
    if (this.proc) {
      if (this.proc.exitCode === null) return this.proc;
      // 既存のthis.procは終了済みだが、その exit/error ハンドラがまだ発火して
      // いない可能性がある(Nodeは exitCode 確定と 'exit'/'error' 発火が同一tick
      // である保証はない)。ここで先に後始末しておけば、後から遅れて発火する
      // 旧ハンドラは handleProcDeath 内の `this.proc !== p` ガードに引っかかり、
      // これから作る新プロセスの状態を巻き添えにしない。
      this.handleProcDeath(this.proc);
    }
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
    p.on("exit", () => this.handleProcDeath(p));
    // spawn自体の失敗(コマンドのENOENT等)は 'exit' ではなく 'error' でのみ通知され、
    // 'exit' は発火しない(Node 22で実測済み)。ここにリスナーが無いと unhandled
    // 'error' で Electron メインプロセスごと落ち、起点のリクエストのPromiseも
    // 'exit' を待ち続けて永久にpendingのままになる。
    p.on("error", (err) => this.handleProcDeath(p, err));
    this.proc = p;
    return p;
  }

  /** exit/error の両方から呼ばれる、プロセス死亡の後始末。p が現在の this.proc と
   *  一致する場合のみ状態を変更する: 既に置き換え済みの旧プロセスに対する遅延
   *  ハンドラが、新プロセスの pending/proc を誤って巻き添えにしないためのガード
   *  (置き換え自体は ensureProc() が行い、その際に旧プロセスの後始末を先に済ませる)。 */
  private handleProcDeath(p: ChildProcessWithoutNullStreams, err?: Error): void {
    if (this.proc !== p) return;
    const crashed = err
      ? new EngineCrashError(`engine process failed to start: ${err.message}`)
      : new EngineCrashError("エンジンプロセスが終了しました");
    for (const [, pend] of this.pending) pend.reject(crashed);
    this.pending.clear();
    this.proc = null;
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
    markAsCurrentAnalyze?: boolean,
  ): Promise<unknown> {
    const p = this.ensureProc();
    const id = this.nextId++;
    if (markAsCurrentAnalyze) this.currentAnalyzeId = id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async ping(): Promise<string> {
    if (this.disposed) throw new Error("EngineClient is disposed");
    return (await this.request("ping", undefined)) as string;
  }

  private async analyzeOnce(
    audioPath: string, onProgress?: (ev: EngineProgress) => void,
  ): Promise<{ analysis: AnalysisResult; warnings: string[] }> {
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const r = (await this.request("analyze", { audioPath }, onProgress, true)) as {
            analysis: AnalysisResult; warnings: string[];
          };
          return { analysis: r.analysis, warnings: r.warnings };
        } catch (e) {
          if (e instanceof EngineError && e.code === -32002 && attempt < BUSY_RETRY_MAX) {
            // busyのレスポンスは既にpendingから外れている(=このidはもう追跡対象
            // ではない)。再試行までの待機中はcancelCurrent()から見て「実行中
            // ジョブなし」として扱う(次のrequest()呼び出しで新しいidが立つ)。
            this.currentAnalyzeId = null;
            await new Promise((r) => setTimeout(r, BUSY_RETRY_MS));
            continue;
          }
          throw e;
        }
      }
    } finally {
      this.currentAnalyzeId = null;
    }
  }

  analyze(
    audioPath: string, onProgress?: (ev: EngineProgress) => void,
  ): Promise<{ analysis: AnalysisResult; warnings: string[] }> {
    if (this.disposed) return Promise.reject(new Error("EngineClient is disposed"));
    const job = this.queue.then(() => this.analyzeOnce(audioPath, onProgress));
    this.queue = job.catch(() => {}); // 失敗してもキューは続行
    return job;
  }

  async cancelCurrent(): Promise<void> {
    if (this.disposed) throw new Error("EngineClient is disposed");
    // 実行中analyzeジョブのid(request()書き込み時に設定・決着時にクリア、上のフィールド
    // 参照)を対象にする。"pendingの最小id" ではない: ping等キューをバイパスする別
    // リクエストがanalyzeより小さいidで同時に飛んでいることがあり得るため(キューに
    // よる直列化はanalyze同士にしか適用されない)。
    const jobId = this.currentAnalyzeId;
    if (jobId === null || !this.proc) return; // 実行中analyzeが無ければno-op(spawnしない)
    await this.request("cancel", { jobId: String(jobId) }).catch(() => {});
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
