import numpy as np

from synth import SR, band_hit_track
from beatmarks_engine.hits import detect_hits

KICKS = [0.5, 1.5, 2.5, 3.5]
HATS = [1.0, 2.0, 3.0]
TOL = 0.035  # hop 512 @22.05kHz ≈ 23ms → ±35ms 許容


def _times(hits, band):
    return [h["timeSec"] for h in hits if h["band"] == band]


def test_kicks_found_in_low_band():
    hits = detect_hits(band_hit_track(4.5, KICKS, HATS), SR)
    low = np.asarray(_times(hits, "low"))
    for k in KICKS:
        assert low.size and np.min(np.abs(low - k)) <= TOL


def test_hats_found_in_high_band_not_low():
    hits = detect_hits(band_hit_track(4.5, KICKS, HATS), SR)
    high = np.asarray(_times(hits, "high"))
    low = np.asarray(_times(hits, "low"))
    for h in HATS:
        assert high.size and np.min(np.abs(high - h)) <= TOL
        # ハット時刻に低域ヒットが出ない
        assert not low.size or np.min(np.abs(low - h)) > 0.1


def test_strengths_normalized_and_sorted():
    hits = detect_hits(band_hit_track(4.5, KICKS, HATS), SR)
    assert all(0.0 < h["strength"] <= 1.0 for h in hits)
    times = [h["timeSec"] for h in hits]
    assert times == sorted(times)
    assert all(isinstance(h["timeSec"], float) for h in hits)


def test_silence_returns_empty():
    y = np.zeros(SR * 3, dtype=np.float32)
    assert detect_hits(y, SR) == []
