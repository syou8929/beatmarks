import numpy as np

from synth import click_track, bpm_ramp_track, SR
from beatmarks_engine.tempo import track_beats


def _recall(true_times, got_times, tol):
    got = np.asarray(got_times)
    hit = sum(1 for t in true_times if got.size and np.min(np.abs(got - t)) <= tol)
    return hit / len(true_times)


def test_fixed_bpm_click_track():
    y, true_beats = click_track(128.0, 30.0, offset=0.25)
    res = track_beats(y, SR)
    assert res["tempoMode"] == "fixed"
    assert abs(res["bpm"] - 128.0) <= 128.0 * 0.005          # ±0.5%
    period = 60.0 / res["bpm"]
    # グリッド位相が 0.25s と一致(mod period で比較、±20ms)
    diff = abs((res["gridOffsetSec"] - 0.25 + period / 2) % period - period / 2)
    assert diff <= 0.02
    # グリッドが実拍を ±30ms で網羅
    assert _recall(true_beats, res["beats"], 0.03) >= 0.97
    assert res["tempoMap"] == [{"timeSec": 0.0, "bpm": res["bpm"]}]
    assert res["beatConfidence"] >= 0.7
    assert all(isinstance(b, float) for b in res["beats"])


def test_variable_bpm_ramp():
    y, true_beats = bpm_ramp_track(120.0, 132.0, 60.0)
    res = track_beats(y, SR)
    assert res["tempoMode"] == "variable"
    assert res["bpm"] is None
    assert _recall(true_beats, res["beats"], 0.05) >= 0.9
    assert len(res["tempoMap"]) == len(res["beats"])
    bpms = [p["bpm"] for p in res["tempoMap"]]
    # テンポマップが加速を捉えている(前半平均 < 後半平均)
    assert np.mean(bpms[: len(bpms) // 3]) < np.mean(bpms[-len(bpms) // 3 :])
    times = [p["timeSec"] for p in res["tempoMap"]]
    assert times == sorted(times)


def test_too_short_audio_degrades_gracefully():
    y, _ = click_track(120.0, 1.2)  # 拍3個未満相当
    res = track_beats(y, SR)
    assert res["tempoMode"] in ("fixed", "variable")
    assert isinstance(res["beats"], list)
    assert res["beatConfidence"] == 0.0
