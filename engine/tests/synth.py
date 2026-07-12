"""テスト用の決定的な合成音源ジェネレータ群。実楽曲は使わない。"""
import numpy as np

SR = 22050


def _click(sr: int, freq: float, dur: float = 0.03, amp: float = 0.9,
           decay: float = 90.0) -> np.ndarray:
    n = int(sr * dur)
    t = np.arange(n) / sr
    return (amp * np.sin(2 * np.pi * freq * t) * np.exp(-t * decay)).astype(np.float32)


def _add(y: np.ndarray, burst: np.ndarray, at_sec: float, sr: int) -> None:
    i = int(round(at_sec * sr))
    j = min(len(y), i + len(burst))
    if j > i:
        y[i:j] += burst[: j - i]


def click_track(bpm: float, dur: float, sr: int = SR, offset: float = 0.0,
                accent_every: int | None = None, click_freq: float = 1000.0,
                accent_freq: float = 90.0, accent_amp: float = 1.0,
                base_amp: float = 0.5) -> tuple[np.ndarray, np.ndarray]:
    """一定BPMのクリック音源。accent_every 拍ごとに低音の強アクセント(擬似キック)。

    Returns: (音声 float32, 拍時刻列)
    """
    y = np.zeros(int(sr * dur), dtype=np.float32)
    period = 60.0 / bpm
    beat_times = []
    k = 0
    while True:
        t = offset + k * period
        if t >= dur - 0.05:
            break
        if accent_every is not None and k % accent_every == 0:
            burst = _click(sr, accent_freq, dur=0.08, amp=accent_amp, decay=35.0)
        else:
            burst = _click(sr, click_freq, amp=base_amp)
        _add(y, burst, t, sr)
        beat_times.append(t)
        k += 1
    return y, np.asarray(beat_times)


def bpm_ramp_track(bpm_start: float, bpm_end: float, dur: float, sr: int = SR,
                   offset: float = 0.0, base_amp: float = 0.6
                   ) -> tuple[np.ndarray, np.ndarray]:
    """BPM が線形に変化するクリック音源。Returns: (音声, 拍時刻列)"""
    y = np.zeros(int(sr * dur), dtype=np.float32)
    beat_times = []
    t = offset
    while t < dur - 0.05:
        _add(y, _click(sr, 1000.0, amp=base_amp), t, sr)
        beat_times.append(t)
        bpm = bpm_start + (bpm_end - bpm_start) * (t / dur)
        t += 60.0 / bpm
    return y, np.asarray(beat_times)


_SCALES = {"major": [0, 2, 4, 5, 7, 9, 11],
           "minor": [0, 2, 3, 5, 7, 8, 11]}  # minor はハーモニックマイナー


def key_tone(root_pc: int, mode: str, dur: float, sr: int = SR) -> np.ndarray:
    """スケール構成音のサイン波合成(3オクターブ、主音は増幅)。キー検出テスト用。"""
    scale = _SCALES[mode]
    t = np.arange(int(sr * dur)) / sr
    y = np.zeros_like(t, dtype=np.float64)
    for octave in (3, 4, 5):
        for deg, step in enumerate(scale):
            midi = 12 * (octave + 1) + (root_pc + step) % 12
            f = 440.0 * 2.0 ** ((midi - 69) / 12.0)
            amp = 0.22 if deg == 0 else 0.10
            y += amp * np.sin(2 * np.pi * f * t)
    peak = max(1.0, float(np.max(np.abs(y))))
    return (0.8 * y / peak).astype(np.float32)


def band_hit_track(dur: float, kick_times, hat_times, sr: int = SR,
                   seed: int = 42) -> np.ndarray:
    """低域キック(60Hz減衰サイン)と高域ハット(高域ノイズバースト)を既知時刻に置く。"""
    rng = np.random.default_rng(seed)
    y = np.zeros(int(sr * dur), dtype=np.float32)
    for kt in kick_times:
        n = int(sr * 0.12)
        t = np.arange(n) / sr
        burst = (0.9 * np.sin(2 * np.pi * 60.0 * t) * np.exp(-t * 35.0)).astype(np.float32)
        _add(y, burst, float(kt), sr)
    for ht in hat_times:
        n = int(sr * 0.05)
        noise = rng.standard_normal(n)
        for _ in range(2):                       # 荒いハイパス(差分×2)
            noise = np.diff(noise, prepend=noise[:1])
        env = np.exp(-np.arange(n) / (sr * 0.008))
        burst = (0.5 * noise / max(1e-9, float(np.max(np.abs(noise)))) * env).astype(np.float32)
        _add(y, burst, float(ht), sr)
    return y


def structure_track(sr: int = SR) -> np.ndarray:
    """30秒: 10s 静かなパッド(A) / 10s 轟音セクション(B) / 10s パッド(A)。展開検出テスト用。"""
    def pad(dur: float, amp: float = 0.03) -> np.ndarray:
        t = np.arange(int(sr * dur)) / sr
        return (amp * (np.sin(2 * np.pi * 220 * t)
                       + 0.5 * np.sin(2 * np.pi * 330 * t))).astype(np.float32)

    def chorus(dur: float, amp: float = 0.55, seed: int = 7) -> np.ndarray:
        rng = np.random.default_rng(seed)
        t = np.arange(int(sr * dur)) / sr
        harm = np.zeros_like(t)
        for k in range(6):
            harm += np.sin(2 * np.pi * 110.0 * (k + 1) * t) / (k + 1)
        noise = 0.3 * rng.standard_normal(len(t))
        pulse = 0.6 + 0.4 * np.square(np.sin(2 * np.pi * 1.0 * t))
        return (amp * pulse * (harm / 2.0 + noise) / 2.2).astype(np.float32)

    return np.concatenate([pad(10.0), chorus(10.0), pad(10.0)])


def silence_gap_track(sr: int = SR) -> np.ndarray:
    """12秒: 5s 220Hzトーン / 1.5s 完全無音 / 5.5s トーン。静寂検出テスト用。"""
    t1 = np.arange(int(sr * 5.0)) / sr
    a = (0.3 * np.sin(2 * np.pi * 220 * t1)).astype(np.float32)
    gap = np.zeros(int(sr * 1.5), dtype=np.float32)
    t2 = np.arange(int(sr * 5.5)) / sr
    b = (0.3 * np.sin(2 * np.pi * 220 * t2)).astype(np.float32)
    return np.concatenate([a, gap, b])


def write_wav(path, y: np.ndarray, sr: int = SR) -> None:
    import soundfile as sf
    sf.write(str(path), y, sr)
