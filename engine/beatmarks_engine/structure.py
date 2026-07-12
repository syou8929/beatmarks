"""展開(セクション)検出。

1. 拍同期特徴(MFCC+クロマ+RMS)を作る
2. コサイン自己相似行列 → Foote チェッカーボードカーネルでノベルティ曲線
3. ピーク位置をセクション境界候補にする(最小間隔 = 8拍)
4. セグメント平均特徴を階層クラスタリングし、同じ素材に同じラベル(A,B,C…)
5. 平均 RMS 最大のクラスタを chorusCandidate とする
"""
import librosa
import numpy as np
import scipy.signal
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import pdist

from .tempo import HOP

KERNEL_HALF = 8       # ノベルティカーネル半幅(拍)= 4/4 で2小節
MIN_GAP_BEATS = 8     # 境界同士の最小間隔(拍)


def _single_section(dur: float) -> list[dict]:
    return [{"startSec": 0.0, "endSec": float(dur), "label": "A",
             "clusterId": 0, "chorusCandidate": False}]


def _beat_sync_features(y: np.ndarray, sr: int, frames: np.ndarray):
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=HOP)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP)
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    feats = np.vstack([
        librosa.util.normalize(mfcc, axis=1),
        librosa.util.normalize(chroma, axis=1),
    ])
    n_frames = feats.shape[1]
    bounds = list(np.clip(frames, 0, n_frames - 1)) + [n_frames]
    beat_feats, beat_rms = [], []
    for i in range(len(frames)):
        lo, hi = bounds[i], max(bounds[i] + 1, bounds[i + 1])
        beat_feats.append(np.median(feats[:, lo:hi], axis=1))
        beat_rms.append(float(np.mean(rms[min(lo, len(rms) - 1): max(hi, lo + 1)])))
    return np.asarray(beat_feats).T, np.asarray(beat_rms)


def _novelty(beat_feats: np.ndarray) -> np.ndarray:
    X = beat_feats / (np.linalg.norm(beat_feats, axis=0, keepdims=True) + 1e-9)
    S = X.T @ X                                   # (n_beats, n_beats)
    L = KERNEL_HALF
    kernel = np.kron(np.array([[1.0, -1.0], [-1.0, 1.0]]), np.ones((L, L)))
    n = S.shape[0]
    nov = np.zeros(n)
    for t in range(L, n - L):
        nov[t] = float(np.sum(S[t - L: t + L, t - L: t + L] * kernel))
    nov -= nov.min()
    return nov


def detect_sections(y: np.ndarray, sr: int, beats: np.ndarray) -> list[dict]:
    dur = len(y) / sr
    beats = np.asarray(beats, dtype=float)
    if len(beats) < KERNEL_HALF * 2 + 1:
        return _single_section(dur)

    frames = librosa.time_to_frames(beats, sr=sr, hop_length=HOP)
    beat_feats, beat_rms = _beat_sync_features(y, sr, frames)
    nov = _novelty(beat_feats)
    if float(nov.max()) <= 1e-9:
        return _single_section(dur)

    peaks, _ = scipy.signal.find_peaks(
        nov, distance=MIN_GAP_BEATS, prominence=0.2 * float(nov.max())
    )
    boundary_beats = [int(p) for p in peaks]
    edges = [0] + boundary_beats + [len(beats)]

    # セグメント平均特徴でクラスタリング
    seg_means, seg_rms, seg_ranges = [], [], []
    for a, b in zip(edges, edges[1:]):
        b = max(b, a + 1)
        seg_means.append(np.mean(beat_feats[:, a:b], axis=1))
        seg_rms.append(float(np.mean(beat_rms[a:b])))
        start = 0.0 if a == 0 else float(beats[a])
        end = dur if b >= len(beats) else float(beats[b])
        seg_ranges.append((start, end))

    if len(seg_means) == 1:
        return _single_section(dur)

    d = pdist(np.asarray(seg_means), metric="euclidean")
    Z = linkage(d, method="average")
    cluster_raw = fcluster(Z, t=0.5 * float(np.max(d)), criterion="distance")

    # クラスタIDを出現順に 0,1,2… へ振り直し、ラベル A,B,C… を割当
    remap: dict[int, int] = {}
    for c in cluster_raw:
        if c not in remap:
            remap[c] = len(remap)
    cluster_ids = [remap[c] for c in cluster_raw]

    # 平均RMS最大のクラスタ = サビ/ドロップ候補
    rms_by_cluster: dict[int, list[float]] = {}
    for cid, r in zip(cluster_ids, seg_rms):
        rms_by_cluster.setdefault(cid, []).append(r)
    chorus_cluster = max(rms_by_cluster, key=lambda c: float(np.mean(rms_by_cluster[c])))
    multiple_clusters = len(rms_by_cluster) > 1

    sections = []
    for (start, end), cid in zip(seg_ranges, cluster_ids):
        sections.append({
            "startSec": start,
            "endSec": end,
            "label": chr(ord("A") + (cid % 26)),
            "clusterId": int(cid),
            "chorusCandidate": bool(multiple_clusters and cid == chorus_cluster),
        })
    return sections
