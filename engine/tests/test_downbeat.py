import numpy as np

from synth import SR, click_track
from beatmarks_engine.downbeat import estimate_downbeat_phase


def _accented_track():
    # 4拍ごとに低音アクセント(擬似キック)。それ以外は高音の弱クリック
    return click_track(
        120.0, 24.0, accent_every=4, accent_amp=1.0, base_amp=0.35
    )


def test_phase_zero_when_beats_align_with_accents():
    y, beats = _accented_track()
    assert estimate_downbeat_phase(y, SR, beats) == 0


def test_phase_shifts_when_beat_list_is_rotated():
    y, beats = _accented_track()
    # 拍列の先頭を2つ落とす → アクセントは位相2に来る
    assert estimate_downbeat_phase(y, SR, beats[2:]) == 2


def test_three_four_time_signature():
    y, beats = click_track(
        120.0, 24.0, accent_every=3, accent_amp=1.0, base_amp=0.35
    )
    assert estimate_downbeat_phase(y, SR, beats, beats_per_bar=3) == 0


def test_too_few_beats_returns_zero():
    y, beats = click_track(120.0, 1.5)
    assert estimate_downbeat_phase(y, SR, beats) == 0
