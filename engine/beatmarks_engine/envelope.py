"""音量エンベロープ(全体+3帯域、100Hz)と静寂検出。

- RMS を hop 256 で計算し dB 化 → −60〜0dB を 0〜1 に正規化 → 100Hz に補間
- 静寂検出は dB 系列へのしきい値+最小継続時間判定。UI 側も同じアルゴリズムを
  TS で持ち、しきい値変更は再解析なしで済む(スペック §5)
"""
import librosa
import numpy as np

from .hits import BANDS, band_filter

ENV_RATE = 100.0
SILENCE_DB = -45.0
SILENCE_MIN_DUR = 0.7

_RMS_HOP = 256
_RMS_FRAME = 1024
_DB_FLOOR = -120.0


def _rms_series(yb: np.ndarray, sr: int, grid: np.ndarray):
    rms = librosa.feature.rms(y=yb, frame_length=_RMS_FRAME, hop_length=_RMS_HOP)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=_RMS_HOP)
    db = 20.0 * np.log10(np.maximum(rms, 10 ** (_DB_FLOOR / 20.0)))
    norm = np.clip((db + 60.0) / 60.0, 0.0, 1.0)
    return np.interp(grid, times, norm), np.interp(grid, times, db)


def compute_envelopes(y: np.ndarray, sr: int) -> tuple[dict, np.ndarray]:
    dur = len(y) / sr
    grid = np.arange(0.0, dur, 1.0 / ENV_RATE)
    total_norm, total_db = _rms_series(y, sr, grid)
    env: dict = {"sampleRateHz": 100, "total": [float(v) for v in total_norm]}
    for band, (lo, hi) in BANDS.items():
        norm, _db = _rms_series(band_filter(y, sr, lo, hi), sr, grid)
        env[band] = [float(v) for v in norm]
    return env, total_db


def detect_silences(total_db: np.ndarray, threshold_db: float = SILENCE_DB,
                    min_dur_sec: float = SILENCE_MIN_DUR,
                    rate_hz: float = ENV_RATE) -> list[dict]:
    below = np.asarray(total_db) < threshold_db
    regions: list[dict] = []

    def _push(a: int, b: int) -> None:
        if (b - a) / rate_hz >= min_dur_sec:
            regions.append({
                "startSec": a / rate_hz,
                "endSec": b / rate_hz,
                "floorDb": float(np.min(total_db[a:b])),
            })

    start: int | None = None
    for i, flag in enumerate(below):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            _push(start, i)
            start = None
    if start is not None:
        _push(start, len(below))
    return regions
