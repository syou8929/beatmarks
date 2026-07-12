import numpy as np

from synth import SR, silence_gap_track, structure_track
from beatmarks_engine.envelope import compute_envelopes, detect_silences


def test_envelope_shape_and_range():
    y = structure_track()  # 30s
    env, total_db = compute_envelopes(y, SR)
    assert env["sampleRateHz"] == 100
    n = len(env["total"])
    assert abs(n - 3000) <= 2                      # 30s × 100Hz
    for k in ("total", "low", "mid", "high"):
        assert len(env[k]) == n
        assert all(0.0 <= v <= 1.0 for v in env[k])
    assert len(total_db) == n
    # 轟音セクション(10-20s)は静パッドより明確に大きい
    assert np.mean(env["total"][1200:1800]) > np.mean(env["total"][200:800]) + 0.1


def test_silence_gap_detected():
    y = silence_gap_track()  # 5.0-6.5s が完全無音
    _env, total_db = compute_envelopes(y, SR)
    regions = detect_silences(total_db)
    assert len(regions) == 1
    r = regions[0]
    assert abs(r["startSec"] - 5.0) <= 0.15
    assert abs(r["endSec"] - 6.5) <= 0.15
    assert r["floorDb"] < -60.0


def test_short_gap_ignored_by_min_duration():
    y = silence_gap_track()
    _env, total_db = compute_envelopes(y, SR)
    assert detect_silences(total_db, min_dur_sec=2.0) == []


def test_threshold_is_refilterable_without_reanalysis():
    y = silence_gap_track()
    _env, total_db = compute_envelopes(y, SR)
    strict = detect_silences(total_db, threshold_db=-80.0)
    loose = detect_silences(total_db, threshold_db=-20.0)
    assert len(loose) >= len(strict)


def test_all_silent_input():
    y = np.zeros(SR * 3, dtype=np.float32)
    _env, total_db = compute_envelopes(y, SR)
    regions = detect_silences(total_db)
    assert len(regions) == 1
    assert regions[0]["startSec"] <= 0.05
    assert regions[0]["endSec"] >= 2.9
