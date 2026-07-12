from synth import SR, key_tone
from beatmarks_engine.key import estimate_key


def test_c_major():
    y = key_tone(0, "major", 8.0)
    k = estimate_key(y, SR)
    assert k["name"] == "C major"
    assert k["camelot"] == "8B"
    assert 0.0 <= k["confidence"] <= 1.0


def test_a_minor():
    y = key_tone(9, "minor", 8.0)
    k = estimate_key(y, SR)
    assert k["name"] == "A minor"
    assert k["camelot"] == "8A"


def test_e_minor_camelot_9a():
    y = key_tone(4, "minor", 8.0)
    k = estimate_key(y, SR)
    assert k["name"] == "E minor"
    assert k["camelot"] == "9A"


def test_range_restriction_picks_local_key():
    import numpy as np
    # 前半 C major / 後半 A minor をつなげ、区間指定でそれぞれを当てる
    y = np.concatenate([key_tone(0, "major", 6.0), key_tone(9, "minor", 6.0)])
    first = estimate_key(y, SR, start_sec=0.0, end_sec=6.0)
    second = estimate_key(y, SR, start_sec=6.0, end_sec=12.0)
    assert first["name"] == "C major"
    assert second["name"] == "A minor"


def test_json_native_types():
    k = estimate_key(key_tone(7, "major", 4.0), SR)
    assert isinstance(k["name"], str)
    assert isinstance(k["camelot"], str)
    assert isinstance(k["confidence"], float)
