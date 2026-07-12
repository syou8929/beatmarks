import io
import json
import subprocess
import sys
import threading
from pathlib import Path

from synth import click_track, write_wav
from beatmarks_engine.rpc import RpcServer

ENGINE_DIR = Path(__file__).resolve().parents[1]


# ---------- ユニット(ストリーム差し替え) ----------

def _run_server_on(lines: list[str], timeout_sec: float = 120.0) -> list[dict]:
    inp = io.StringIO("".join(l + "\n" for l in lines))
    out = io.StringIO()
    server = RpcServer(in_stream=inp, out_stream=out)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    t.join(timeout=timeout_sec)
    assert not t.is_alive(), "server did not finish"
    server.wait_for_jobs(timeout=timeout_sec)
    return [json.loads(l) for l in out.getvalue().splitlines() if l.strip()]


def test_ping_and_version():
    msgs = _run_server_on([
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}),
        json.dumps({"jsonrpc": "2.0", "id": 2, "method": "version"}),
    ])
    by_id = {m.get("id"): m for m in msgs if "id" in m}
    assert by_id[1]["result"] == "pong"
    assert by_id[2]["result"]["engine"] == "0.1.0"


def test_unknown_method_error():
    msgs = _run_server_on([json.dumps({"jsonrpc": "2.0", "id": 5, "method": "nope"})])
    assert msgs[0]["error"]["code"] == -32601


def test_parse_error():
    msgs = _run_server_on(["this is not json"])
    assert msgs[0]["error"]["code"] == -32700


def test_analyze_with_progress(tmp_path):
    y, _ = click_track(120.0, 8.0)
    wav = tmp_path / "t.wav"
    write_wav(wav, y)
    msgs = _run_server_on([json.dumps({
        "jsonrpc": "2.0", "id": 10, "method": "analyze",
        "params": {"audioPath": str(wav)},
    })])
    progress = [m for m in msgs if m.get("method") == "progress"]
    result = next(m for m in msgs if m.get("id") == 10)
    assert len(progress) >= 3
    assert all(p["params"]["jobId"] == "10" for p in progress)
    assert result["result"]["jobId"] == "10"
    assert abs(result["result"]["analysis"]["durationSec"] - 8.0) < 0.1


def test_analyze_missing_file_error(tmp_path):
    msgs = _run_server_on([json.dumps({
        "jsonrpc": "2.0", "id": 11, "method": "analyze",
        "params": {"audioPath": str(tmp_path / "none.wav")},
    })])
    result = next(m for m in msgs if m.get("id") == 11)
    assert result["error"]["code"] == -32001


# ---------- E2E(サブプロセス) ----------

def test_subprocess_ping():
    proc = subprocess.Popen(
        [sys.executable, "-m", "beatmarks_engine"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        text=True, cwd=str(ENGINE_DIR),
    )
    try:
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}) + "\n")
        proc.stdin.flush()
        line = proc.stdout.readline()
        assert json.loads(line)["result"] == "pong"
    finally:
        proc.stdin.close()
        proc.wait(timeout=30)


def test_cli_oneshot_analyze(tmp_path):
    y, _ = click_track(120.0, 6.0)
    wav = tmp_path / "one.wav"
    write_wav(wav, y)
    out = tmp_path / "out.json"
    r = subprocess.run(
        [sys.executable, "-m", "beatmarks_engine",
         "--analyze", str(wav), "--out", str(out)],
        cwd=str(ENGINE_DIR), capture_output=True, text=True, timeout=300,
    )
    assert r.returncode == 0, r.stderr
    data = json.loads(out.read_text())
    assert "analysis" in data and "warnings" in data


def test_cli_version():
    r = subprocess.run(
        [sys.executable, "-m", "beatmarks_engine", "--version"],
        cwd=str(ENGINE_DIR), capture_output=True, text=True, timeout=60,
    )
    assert r.returncode == 0
    assert r.stdout.strip() == "0.1.0"
