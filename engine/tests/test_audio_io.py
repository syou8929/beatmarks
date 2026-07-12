import numpy as np
import pytest
import soundfile as sf

from synth import click_track, write_wav
from beatmarks_engine.audio_io import ANALYSIS_SR, AudioLoadError, load_analysis_audio


def test_loads_wav_as_mono_22050(tmp_path):
    y, _ = click_track(120.0, 3.0)
    p = tmp_path / "a.wav"
    write_wav(p, y)
    out, sr = load_analysis_audio(p)
    assert sr == ANALYSIS_SR == 22050
    assert out.ndim == 1
    assert out.dtype == np.float32
    assert abs(len(out) / sr - 3.0) < 0.05


def test_resamples_to_22050(tmp_path):
    # 44.1kHz のファイルでも 22.05kHz に揃う
    t = np.arange(44100 * 2) / 44100
    y = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    p = tmp_path / "b.wav"
    write_wav(p, y, sr=44100)
    out, sr = load_analysis_audio(p)
    assert sr == 22050
    assert abs(len(out) / sr - 2.0) < 0.05


def test_missing_file_raises(tmp_path):
    with pytest.raises(AudioLoadError):
        load_analysis_audio(tmp_path / "nothing.wav")


def test_garbage_file_raises(tmp_path):
    p = tmp_path / "junk.wav"
    p.write_bytes(b"not a wav at all")
    with pytest.raises(AudioLoadError):
        load_analysis_audio(p)


def test_empty_audio_raises(tmp_path):
    # ヘッダは正しいが中身が0フレームの WAV
    p = tmp_path / "empty.wav"
    sf.write(str(p), np.zeros((0,), dtype=np.float32), 22050)
    with pytest.raises(AudioLoadError):
        load_analysis_audio(p)
