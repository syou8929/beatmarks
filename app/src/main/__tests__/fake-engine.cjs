// 偽エンジン: 実エンジンと同じNDJSON JSON-RPCを話す。引数でシナリオ切替。
// scenario: normal | crash-mid | busy-once
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
function handle(msg) {
  if (msg.method === "ping") return send({ jsonrpc: "2.0", id: msg.id, result: "pong" });
  if (msg.method === "cancel") return send({ jsonrpc: "2.0", id: msg.id, result: { cancelled: true } });
  if (msg.method === "analyze") {
    if (scenario === "busy-once" && !busySent) {
      busySent = true;
      return send({ jsonrpc: "2.0", id: msg.id, error: { code: -32002, message: "busy" } });
    }
    send({ jsonrpc: "2.0", method: "progress", params: { jobId: String(msg.id), stage: "load", percent: 0 } });
    if (scenario === "crash-mid") process.exit(9);
    send({ jsonrpc: "2.0", method: "progress", params: { jobId: String(msg.id), stage: "done", percent: 100 } });
    return send({
      jsonrpc: "2.0", id: msg.id,
      result: { jobId: String(msg.id), analysis: { fake: true, path: msg.params.audioPath }, warnings: [] },
    });
  }
  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unknown" } });
}
