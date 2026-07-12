import json

import numpy as np
import pytest

from synth import SR, click_track, silence_gap_track, structure_track, write_wav
from beatmarks_engine.analyze import (
    AnalysisCancelled,
    analyze,
    bar_times,
    snap_sections_to_bars,
)


def _fixture_wav(tmp_path, name="fx.wav"):
    """クリック(拍あり)+振幅変化(展開あり)を合成した 30 秒素材。"""
    clicks, _ = click_track(120.0, 30.0, base_amp=0.5)
    y = structure_track() * 0.6 + clicks * 0.5
    peak = float(np.max(np.abs(y)))
    y = (y / peak * 0.9).astype(np.float32)
    p = tmp_path / name
    write_wav(p, y)
    return p


def test_bar_times_phase():
    beats = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]
    assert bar_times(beats, 0) == [0.0, 2.0]
    assert bar_times(beats, 2) == [1.0, 3.0]
    assert bar_times(beats, 1, beats_per_bar=3) == [0.5, 2.0, 3.5]


def test_snap_sections_to_bars():
    sections = [
        {"startSec": 0.0, "endSec": 9.7, "label": "A", "clusterId": 0, "chorusCandidate": False},
        {"startSec": 9.7, "endSec": 20.4, "label": "B", "clusterId": 1, "chorusCandidate": True},
        {"startSec": 20.4, "endSec": 30.0, "label": "A", "clusterId": 0, "chorusCandidate": False},
    ]
    bars = [float(t) for t in np.arange(0.0, 30.0, 2.0)]
    out = snap_sections_to_bars(sections, bars, 30.0)
    assert out[0]["startSec"] == 0.0
    assert out[-1]["endSec"] == 30.0
    assert out[1]["startSec"] == 10.0            # 9.7 → 最寄りの小節頭 10.0
    assert out[2]["startSec"] == 20.0
    for a, b in zip(out, out[1:]):
        assert a["endSec"] == b["startSec"]
    assert [s["label"] for s in out] == ["A", "B", "A"]


def test_snap_drops_collapsed_sections():
    sections = [
        {"startSec": 0.0, "endSec": 9.9, "label": "A", "clusterId": 0, "chorusCandidate": False},
        {"startSec": 9.9, "endSec": 10.2, "label": "B", "clusterId": 1, "chorusCandidate": False},
        {"startSec": 10.2, "endSec": 20.0, "label": "C", "clusterId": 2, "chorusCandidate": False},
    ]
    bars = [float(t) for t in np.arange(0.0, 20.0, 2.0)]
    out = snap_sections_to_bars(sections, bars, 20.0)
    # 9.9 も 10.2 も 10.0 に吸着 → 幅0の B は消える
    assert [s["label"] for s in out] == ["A", "C"]
    assert out[0]["endSec"] == 10.0 == out[1]["startSec"]


def test_full_analyze_returns_valid_json(tmp_path):
    stages = []

    def progress(stage, pct):
        stages.append((stage, pct))

    result = analyze(str(_fixture_wav(tmp_path)), progress=progress)
    text = json.dumps(result)                     # numpy 型が混ざれば TypeError
    assert isinstance(text, str)

    a = result["analysis"]
    assert abs(a["durationSec"] - 30.0) < 0.1
    assert a["tempoMode"] in ("fixed", "variable")
    assert len(a["beats"]) > 30
    assert a["downbeatPhase"] in (0, 1, 2, 3)
    assert set(a["key"]) == {"global", "perSection"}
    assert len(a["key"]["perSection"]) == len(a["sections"])
    assert a["sections"][0]["startSec"] == 0.0
    assert abs(a["sections"][-1]["endSec"] - a["durationSec"]) < 0.01
    assert isinstance(a["hits"], list) and len(a["hits"]) > 0
    assert isinstance(a["silences"], list)
    assert a["envelopes"]["sampleRateHz"] == 100
    assert isinstance(result["warnings"], list)

    # セクション境界(先頭以外)は小節頭に一致
    from beatmarks_engine.analyze import bar_times as _bt
    bars = _bt(a["beats"], a["downbeatPhase"])
    for s in a["sections"][1:]:
        assert min(abs(s["startSec"] - b) for b in bars) < 1e-6

    # 進捗は単調増加で 100 まで到達、ステージ名が正しい
    pcts = [p for _, p in stages]
    assert pcts == sorted(pcts) and pcts[-1] == 100
    assert [s for s, _ in stages][0] == "load"
    assert stages[-1][0] == "done"


def test_short_audio_warning(tmp_path):
    p = tmp_path / "short.wav"
    write_wav(p, silence_gap_track()[: SR * 5])   # 5秒
    result = analyze(str(p))
    assert "short-audio" in result["warnings"]


def test_cancellation(tmp_path):
    calls = {"n": 0}

    def is_cancelled():
        calls["n"] += 1
        return calls["n"] > 1                     # 2回目のチェックで中断

    with pytest.raises(AnalysisCancelled):
        analyze(str(_fixture_wav(tmp_path, "c.wav")), is_cancelled=is_cancelled)
