"""1拍目(小節頭)の位相推定。

拍ごとのスコア = 低域オンセット強度(正規化) + クロマ変化量(正規化)
を位相別に平均し、最大の位相を小節頭とする。4/4 前提だが beats_per_bar
引数で 3/4 等にも対応する(スペック §3.2-2)。
"""
import librosa
import numpy as np
import scipy.signal

from .tempo import HOP


def _low_band(y: np.ndarray, sr: int) -> np.ndarray:
    sos = scipy.signal.butter(4, 200.0, btype="lowpass", fs=sr, output="sos")
    return np.ascontiguousarray(scipy.signal.sosfiltfilt(sos, y)).astype(np.float32)


def estimate_downbeat_phase(y: np.ndarray, sr: int, beats: np.ndarray,
                            beats_per_bar: int = 4) -> int:
    beats = np.asarray(beats, dtype=float)
    if len(beats) < beats_per_bar * 2:
        return 0

    frames = librosa.time_to_frames(beats, sr=sr, hop_length=HOP)

    # 低域オンセット強度(キック・ベースの位置で大きい)
    low_env = librosa.onset.onset_strength(y=_low_band(y, sr), sr=sr, hop_length=HOP)
    frames = np.clip(frames, 0, len(low_env) - 1)
    # onset_strength のピークは実際のオンセットよりも系統的に約1フレーム
    # (HOP/sr ≈ 23ms; tempo.py の実装メモにある約20ms遅延と同じ現象)遅れる。
    # 名目フレームをそのまま参照すると既知の拍時刻はピーク到達前を指してしまい
    # 強度が恒常的に0になる(実測: このテストの拍48個全てで0)ため、
    # 名目フレームと次フレームの最大値を取って遅延を吸収する。
    frames_lead = np.clip(frames + 1, 0, len(low_env) - 1)
    strength = np.maximum(low_env[frames], low_env[frames_lead])

    # 拍区間ごとのクロマ中央値 → 隣接区間との差 = 和声変化量
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP)
    seg_feats = []
    bounds = list(frames) + [chroma.shape[1]]
    for i in range(len(frames)):
        lo, hi = bounds[i], max(bounds[i] + 1, bounds[i + 1])
        seg_feats.append(np.median(chroma[:, lo:hi], axis=1))
    seg_feats = np.asarray(seg_feats)
    novelty = np.zeros(len(frames))
    if len(seg_feats) > 1:
        d = np.linalg.norm(np.diff(seg_feats, axis=0), axis=1)
        novelty[1:] = d

    def _norm(v: np.ndarray) -> np.ndarray:
        m = float(np.max(v))
        return v / m if m > 1e-9 else np.zeros_like(v)

    score = _norm(strength) + _norm(novelty)
    phase_scores = [
        float(np.mean(score[p::beats_per_bar])) for p in range(beats_per_bar)
    ]
    return int(np.argmax(phase_scores))
