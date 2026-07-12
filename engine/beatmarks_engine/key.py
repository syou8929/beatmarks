"""キー推定: CQT クロマの時間平均 × Krumhansl-Schmuckler テンプレート相関。

信頼度 = (1位の相関 − 2位の相関) を 5 倍して 0〜1 にクリップ(経験的スケール。
スペック §5「信頼度 = 1位と2位の相関差」の実装)。
"""
import librosa
import numpy as np

from .tempo import HOP

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Kessler major/minor key profiles
KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# Camelot ホイール: (mode, pitch_class) -> code
_CAMELOT_MINOR = {8: "1A", 3: "2A", 10: "3A", 5: "4A", 0: "5A", 7: "6A",
                  2: "7A", 9: "8A", 4: "9A", 11: "10A", 6: "11A", 1: "12A"}
_CAMELOT_MAJOR = {11: "1B", 6: "2B", 1: "3B", 8: "4B", 3: "5B", 10: "6B",
                  5: "7B", 0: "8B", 7: "9B", 2: "10B", 9: "11B", 4: "12B"}


def _camelot(mode: str, pc: int) -> str:
    return (_CAMELOT_MAJOR if mode == "major" else _CAMELOT_MINOR)[pc]


def estimate_key(y: np.ndarray, sr: int,
                 start_sec: float | None = None,
                 end_sec: float | None = None) -> dict:
    if start_sec is not None or end_sec is not None:
        i = int((start_sec or 0.0) * sr)
        j = int(end_sec * sr) if end_sec is not None else len(y)
        y = y[max(0, i): max(0, j)]
    if y.size < sr // 2:  # 0.5秒未満は判定不能 → 低信頼の既定値
        return {"name": "C major", "camelot": "8B", "confidence": 0.0}

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP)
    v = np.mean(chroma, axis=1)
    if float(np.max(v)) <= 1e-9:
        return {"name": "C major", "camelot": "8B", "confidence": 0.0}

    scores: list[tuple[float, str, int]] = []
    for pc in range(12):
        for mode, profile in (("major", KS_MAJOR), ("minor", KS_MINOR)):
            template = np.roll(profile, pc)  # template[i] = profile[(i - pc) % 12]
            r = float(np.corrcoef(v, template)[0, 1])
            scores.append((r, mode, pc))
    scores.sort(key=lambda s: s[0], reverse=True)
    best, second = scores[0], scores[1]
    confidence = float(np.clip((best[0] - second[0]) * 5.0, 0.0, 1.0))
    mode, pc = best[1], best[2]
    return {
        "name": f"{PITCH_CLASSES[pc]} {mode}",
        "camelot": _camelot(mode, pc),
        "confidence": confidence,
    }
