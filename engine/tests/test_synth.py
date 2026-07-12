import numpy as np

from synth import (
    SR,
    click_track,
    bpm_ramp_track,
    key_tone,
    band_hit_track,
    structure_track,
    silence_gap_track,
)


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x)))) if x.size else 0.0


def test_click_track_places_clicks_on_beats():
    y, beats = click_track(120.0, 5.0)
    assert SR == 22050
    assert y.dtype == np.float32
    assert len(y) == 5 * SR
    # 120BPM, offset0 → 0.0,0.5,...,4.5 の10拍(末尾50msは置かない)
    assert len(beats) == 10
    assert np.allclose(np.diff(beats), 0.5)
    # 拍位置の直後30msは、拍間の谷よりエネルギーが大きい
    for t in beats:
        i = int(t * SR)
        on = _rms(y[i : i + int(0.03 * SR)])
        off = _rms(y[i + int(0.2 * SR) : i + int(0.3 * SR)])
        assert on > off * 5
    assert float(np.max(np.abs(y))) <= 1.5


def test_click_track_accent_is_low_frequency_and_louder():
    y, beats = click_track(
        120.0, 4.0, accent_every=4, accent_amp=1.0, base_amp=0.4
    )
    i0 = int(beats[0] * SR)  # アクセント(90Hz)
    i1 = int(beats[1] * SR)  # 通常(1000Hz)
    a = _rms(y[i0 : i0 + int(0.03 * SR)])
    b = _rms(y[i1 : i1 + int(0.03 * SR)])
    assert a > b


def test_bpm_ramp_track_intervals_shrink():
    y, beats = bpm_ramp_track(120.0, 132.0, 30.0)
    ibis = np.diff(beats)
    assert ibis[0] > ibis[-1]           # 加速している
    assert 0.44 < ibis[-1] < 0.51       # 132BPM≈0.4545s 付近まで
    assert len(y) == 30 * SR


def test_key_tone_is_normalized_and_deterministic():
    y1 = key_tone(0, "major", 2.0)
    y2 = key_tone(0, "major", 2.0)
    assert np.array_equal(y1, y2)
    assert float(np.max(np.abs(y1))) <= 1.0


def test_band_hit_track_kick_is_low_band():
    y = band_hit_track(3.0, kick_times=[0.5], hat_times=[1.5])
    assert len(y) == 3 * SR
    kick = y[int(0.5 * SR) : int(0.5 * SR) + int(0.05 * SR)]
    hat = y[int(1.5 * SR) : int(1.5 * SR) + int(0.02 * SR)]
    # キック区間は正負にゆっくり振れる(低周波)、ハットは細かく振れる(符号反転が多い)
    kick_flips = int(np.sum(np.diff(np.sign(kick)) != 0))
    hat_flips = int(np.sum(np.diff(np.sign(hat)) != 0))
    assert hat_flips > kick_flips


def test_structure_track_middle_is_louder():
    y = structure_track()
    assert len(y) == 30 * SR
    assert _rms(y[10 * SR : 20 * SR]) > 3 * _rms(y[: 10 * SR])


def test_silence_gap_track_has_true_silence():
    y = silence_gap_track()
    assert len(y) == 12 * SR
    gap = y[int(5.1 * SR) : int(6.4 * SR)]
    assert float(np.max(np.abs(gap))) == 0.0
