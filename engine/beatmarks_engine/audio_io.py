"""音声ファイルの読み込みと解析用フォーマットへの正規化。

エンジンが受けるのはアプリ側(ffmpeg)が抽出済みの WAV が基本だが、
librosa(soundfile/audioread)が読める形式なら何でも受ける。
"""
from pathlib import Path

import librosa
import numpy as np

ANALYSIS_SR = 22050


class AudioLoadError(Exception):
    """音声が読み込めない・空・壊れている。"""


def load_analysis_audio(path) -> tuple[np.ndarray, int]:
    p = Path(path)
    if not p.is_file():
        raise AudioLoadError(f"file not found: {p}")
    try:
        y, _sr = librosa.load(str(p), sr=ANALYSIS_SR, mono=True)
    except Exception as e:  # soundfile/audioread の例外は多種 → 集約
        raise AudioLoadError(f"cannot read audio: {p}: {e}") from e
    if y.size == 0:
        raise AudioLoadError(f"audio is empty: {p}")
    return np.ascontiguousarray(y, dtype=np.float32), ANALYSIS_SR
