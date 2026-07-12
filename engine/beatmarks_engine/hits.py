"""帯域別ヒット(トランジェント)検出。

3帯域にバンドパスした信号ごとにオンセット検出し、強度(そのオンセット位置の
オンセット包絡値を帯域内最大で正規化)付きで全候補を返す。しきい値カットは
UI 側の責務(スペック §3.2-5: スライダーで再解析なしに密度調整)。

実装メモ(検証済みの調整、詳細は task-7-report.md 参照):
- `librosa.onset.onset_detect` は既定で `normalize=True`(ピーク判定の前に
  オンセット包絡を [0, 1] に再スケールする)。本実装は `delta` を帯域ピーク
  (生スケール、`peak = max(env)`)に対する比率で計算しているため、既定のまま
  渡すと delta が生スケールのまま [0, 1] 包絡と比較され実質的に過大になる。
  実測: low 帯域(env 最大 ≈2.5)は偶然 delta≈0.12 が妥当な閾値になり4件とも
  検出できていたが、mid/high 帯域(env 最大 ≈19)は delta≈0.95 となり
  ヒットが1件も検出されなくなっていた(ハットが検出されずテスト失敗)。
  `normalize=False` を明示し、`delta` を渡した生スケールの包絡と一貫させる。
"""
import librosa
import numpy as np
import scipy.signal

from .tempo import HOP

BANDS: dict[str, tuple[float | None, float | None]] = {
    "low": (None, 150.0),
    "mid": (150.0, 2000.0),
    "high": (5000.0, None),
}


def band_filter(y: np.ndarray, sr: int,
                lo: float | None, hi: float | None) -> np.ndarray:
    if lo is None:
        sos = scipy.signal.butter(4, hi, btype="lowpass", fs=sr, output="sos")
    elif hi is None:
        sos = scipy.signal.butter(4, lo, btype="highpass", fs=sr, output="sos")
    else:
        sos = scipy.signal.butter(4, [lo, hi], btype="bandpass", fs=sr, output="sos")
    return np.ascontiguousarray(scipy.signal.sosfiltfilt(sos, y)).astype(np.float32)


def detect_hits(y: np.ndarray, sr: int) -> list[dict]:
    out: list[dict] = []
    for band, (lo, hi) in BANDS.items():
        yb = band_filter(y, sr, lo, hi)
        env = librosa.onset.onset_strength(y=yb, sr=sr, hop_length=HOP)
        peak = float(np.max(env)) if env.size else 0.0
        if peak <= 1e-6:
            continue
        # normalize=False: delta は生スケールの peak に対する比率なので、
        # onset_detect 側の既定の [0, 1] 再正規化を無効にして揃える(モジュール
        # docstring の実装メモ参照)。
        frames = librosa.onset.onset_detect(
            onset_envelope=env, sr=sr, hop_length=HOP,
            backtrack=False, delta=0.05 * peak, normalize=False,
        )
        times = librosa.frames_to_time(frames, sr=sr, hop_length=HOP)
        for f, t in zip(frames, times):
            out.append({
                "timeSec": float(t),
                "band": band,
                "strength": float(env[f] / peak),
            })
    out.sort(key=lambda h: h["timeSec"])
    return out
