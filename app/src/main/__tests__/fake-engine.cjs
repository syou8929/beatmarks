// 偽エンジン: 実エンジンと同じNDJSON JSON-RPCを話す。引数でシナリオ切替。
// scenario: normal | crash-mid | busy-once | slow-cancel
const scenario = process.argv[2] ?? "normal";
let busySent = false;
process.stdin.setEncoding("utf-8");
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    handle(msg);
  }
});
function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

// slow-cancel シナリオ専用の状態: 実行中のanalyzeジョブ。実エンジン(rpc.py)と同じく
// jobId = 元のanalyzeリクエストのidを文字列化したもの。cancelはこのjobIdと一致した
// 場合のみ実際にキャンセルする(不一致はcancelled:falseを返すのみで無視する ——
// 実エンジンの `_cancel_flags.get(str(params.get("jobId")))` と同じ挙動)。
// 他のシナリオでは従来通りcancelを常に{cancelled:true}として即答する(挙動変更なし)。
let slowJob = null; // { id, timer }

function handle(msg) {
  if (msg.method === "ping") return send({ jsonrpc: "2.0", id: msg.id, result: "pong" });
  if (msg.method === "cancel") {
    if (scenario !== "slow-cancel") {
      return send({ jsonrpc: "2.0", id: msg.id, result: { cancelled: true } });
    }
    const jobId = msg.params && msg.params.jobId;
    if (slowJob && String(slowJob.id) === String(jobId)) {
      clearTimeout(slowJob.timer);
      const cancelledId = slowJob.id;
      slowJob = null;
      send({ jsonrpc: "2.0", id: msg.id, result: { cancelled: true } });
      send({ jsonrpc: "2.0", id: cancelledId, error: { code: -32800, message: "cancelled" } });
      return;
    }
    return send({ jsonrpc: "2.0", id: msg.id, result: { cancelled: false } });
  }
  if (msg.method === "analyze") {
    if (scenario === "busy-once" && !busySent) {
      busySent = true;
      return send({ jsonrpc: "2.0", id: msg.id, error: { code: -32002, message: "busy" } });
    }
    send({ jsonrpc: "2.0", method: "progress", params: { jobId: String(msg.id), stage: "load", percent: 0 } });
    if (scenario === "crash-mid") process.exit(9);
    if (scenario === "slow-cancel") {
      // cancelが来なければ4秒後に正常終了する(テストがcancelし忘れた場合の
      // フォールバックであり、通常のテスト経路では発火しない想定)。
      const timer = setTimeout(() => {
        slowJob = null;
        send({ jsonrpc: "2.0", method: "progress", params: { jobId: String(msg.id), stage: "done", percent: 100 } });
        send({
          jsonrpc: "2.0", id: msg.id,
          result: { jobId: String(msg.id), analysis: { fake: true, path: msg.params.audioPath }, warnings: [] },
        });
      }, 4000);
      slowJob = { id: msg.id, timer };
      return;
    }
    send({ jsonrpc: "2.0", method: "progress", params: { jobId: String(msg.id), stage: "done", percent: 100 } });
    return send({
      jsonrpc: "2.0", id: msg.id,
      result: { jobId: String(msg.id), analysis: { fake: true, path: msg.params.audioPath }, warnings: [] },
    });
  }
  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unknown" } });
}
