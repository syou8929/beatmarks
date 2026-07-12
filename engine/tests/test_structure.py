import numpy as np

from synth import SR, structure_track
from beatmarks_engine.structure import detect_sections


def _uniform_beats(dur: float, period: float = 0.5, offset: float = 0.25):
    return np.arange(offset, dur, period)


def test_detects_three_part_structure():
    y = structure_track()  # 10s 静 / 10s 轟 / 10s 静
    secs = detect_sections(y, SR, _uniform_beats(30.0))
    assert len(secs) >= 3
    # 全体を隙間なく覆う
    assert secs[0]["startSec"] == 0.0
    assert abs(secs[-1]["endSec"] - 30.0) < 0.01
    for a, b in zip(secs, secs[1:]):
        assert abs(a["endSec"] - b["startSec"]) < 1e-6
    # 10s / 20s 付近に境界がある(±1.0s)
    bounds = [s["startSec"] for s in secs[1:]]
    assert any(abs(b - 10.0) <= 1.0 for b in bounds)
    assert any(abs(b - 20.0) <= 1.0 for b in bounds)


def test_same_material_gets_same_label():
    y = structure_track()
    secs = detect_sections(y, SR, _uniform_beats(30.0))
    first, last = secs[0], secs[-1]
    assert first["clusterId"] == last["clusterId"]
    assert first["label"] == last["label"]
    # 中央の轟音セクションは別クラスタ
    mid = next(s for s in secs if s["startSec"] <= 15.0 < s["endSec"])
    assert mid["clusterId"] != first["clusterId"]


def test_loudest_cluster_is_chorus_candidate():
    y = structure_track()
    secs = detect_sections(y, SR, _uniform_beats(30.0))
    mid = next(s for s in secs if s["startSec"] <= 15.0 < s["endSec"])
    assert mid["chorusCandidate"] is True
    assert secs[0]["chorusCandidate"] is False


def test_few_beats_returns_single_section():
    y = structure_track()[: SR * 3]
    secs = detect_sections(y, SR, np.array([0.5, 1.0, 1.5]))
    assert len(secs) == 1
    assert secs[0]["label"] == "A"
    assert secs[0]["chorusCandidate"] is False
