"""stdio 上の NDJSON / JSON-RPC 2.0 サーバー。

- analyze はワーカースレッドで実行し、メインループは cancel を受け続ける
- 書き込みはロックで直列化(進捗通知とレスポンスの行が混ざらないように)
- 同時実行は 1 ジョブ(スペック Global Constraints)。実行中の analyze が
  ある間に来た analyze は error -32002 (busy) を返す
"""
import json
import sys
import threading

from . import ENGINE_VERSION
from .analyze import AnalysisCancelled, analyze
from .audio_io import AudioLoadError

E_PARSE = -32700
E_UNKNOWN_METHOD = -32601
E_INTERNAL = -32000
E_AUDIO_LOAD = -32001
E_BUSY = -32002
E_CANCELLED = -32800


class RpcServer:
    def __init__(self, in_stream=None, out_stream=None):
        self.inp = in_stream if in_stream is not None else sys.stdin
        self.out = out_stream if out_stream is not None else sys.stdout
        self._write_lock = threading.Lock()
        self._cancel_flags: dict[str, threading.Event] = {}
        self._jobs: list[threading.Thread] = []

    # ---- 出力 ----
    def _send(self, obj: dict) -> None:
        with self._write_lock:
            self.out.write(json.dumps(obj) + "\n")
            self.out.flush()

    def _notify(self, method: str, params: dict) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def _respond(self, msg_id, result) -> None:
        self._send({"jsonrpc": "2.0", "id": msg_id, "result": result})

    def _error(self, msg_id, code: int, message: str) -> None:
        self._send({"jsonrpc": "2.0", "id": msg_id,
                    "error": {"code": code, "message": message}})

    # ---- メインループ ----
    def serve_forever(self) -> None:
        for line in self.inp:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                self._error(None, E_PARSE, "parse error")
                continue
            if not isinstance(msg, dict):
                # 構文的には正しい JSON だがオブジェクトでない(配列・数値等)。
                # handle() の型契約(msg: dict)を守るため、ここで弾く。
                self._error(None, E_PARSE, "parse error: expected a JSON object")
                continue
            self.handle(msg)

    def wait_for_jobs(self, timeout: float | None = None) -> None:
        for t in self._jobs:
            t.join(timeout=timeout)

    # ---- ディスパッチ ----
    def handle(self, msg: dict) -> None:
        method = msg.get("method")
        msg_id = msg.get("id")
        params = msg.get("params")
        if not isinstance(params, dict):
            params = {}
        if method == "ping":
            self._respond(msg_id, "pong")
        elif method == "version":
            self._respond(msg_id, {"engine": ENGINE_VERSION})
        elif method == "cancel":
            ev = self._cancel_flags.get(str(params.get("jobId")))
            if ev is not None:
                ev.set()
                self._respond(msg_id, {"cancelled": True})
            else:
                self._respond(msg_id, {"cancelled": False})
        elif method == "analyze":
            if self._cancel_flags:
                self._error(msg_id, E_BUSY, "another analyze is running")
                return
            job_id = str(msg_id)
            ev = threading.Event()
            self._cancel_flags[job_id] = ev
            t = threading.Thread(
                target=self._run_analyze, args=(msg_id, job_id, params, ev),
                daemon=True,
            )
            self._jobs.append(t)
            t.start()
        else:
            self._error(msg_id, E_UNKNOWN_METHOD, f"unknown method: {method}")

    def _run_analyze(self, msg_id, job_id: str, params: dict,
                     cancel_ev: threading.Event) -> None:
        try:
            result = analyze(
                params["audioPath"],
                params.get("options"),
                progress=lambda stage, pct: self._notify(
                    "progress", {"jobId": job_id, "stage": stage, "percent": pct}
                ),
                is_cancelled=cancel_ev.is_set,
            )
            self._respond(msg_id, {"jobId": job_id, **result})
        except AnalysisCancelled:
            self._error(msg_id, E_CANCELLED, "cancelled")
        except AudioLoadError as e:
            self._error(msg_id, E_AUDIO_LOAD, str(e))
        except KeyError as e:
            self._error(msg_id, E_INTERNAL, f"missing param: {e}")
        except Exception as e:  # 解析中の想定外エラーでもプロセスは落とさない
            self._error(msg_id, E_INTERNAL, f"internal error: {e}")
        finally:
            self._cancel_flags.pop(job_id, None)
