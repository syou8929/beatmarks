"""解析オーケストレータ。全モジュールを順に実行して AnalysisResult(JSON形)を組む。

進捗は progress(stage, percent) で通知し、is_cancelled() が True を返したら
次のステージ境界で AnalysisCancelled を投げる(協調的キャンセル)。
"""
from typing import Callable

import numpy as np

from .audio_io import load_analysis_audio
from .downbeat import estimate_downbeat_phase
from .envelope import compute_envelopes, detect_silences
from .hits import detect_hits
from .key import estimate_key
from .structure import detect_sections
from .tempo import track_beats

Progress = Callable[[str, int], None]
Cancelled = Callable[[], bool]


class AnalysisCancelled(Exception):
    """ユーザー操作により解析が中断された。"""


def bar_times(beats: list[float], phase: int, beats_per_bar: int = 4) -> list[float]:
    return [float(beats[i]) for i in range(phase, len(beats), beats_per_bar)]


def snap_sections_to_bars(sections: list[dict], bars: list[float],
                          dur: float) -> list[dict]:
    """内部境界を最寄りの小節頭へ吸着する。

    吸着の結果、幅が 0 になったセクションは除去する(短い断片ではなく、
    残った隣のセクションが空いた区間を引き継ぐ)。先頭は常に 0.0、
    末尾は常に dur で全体を隙間なく覆う。
    """
    if not sections:
        return sections
    if not bars or len(sections) == 1:
        secs = [{**sections[0], "startSec": 0.0}] + [dict(s) for s in sections[1:]]
        secs[-1] = {**secs[-1], "endSec": float(dur)}
        return secs

    def _snap(t: float) -> float:
        return min(bars, key=lambda b: abs(b - t))

    starts = [0.0] + [_snap(float(s["startSec"])) for s in sections[1:]]
    ends = starts[1:] + [float(dur)]
    out: list[dict] = []
    for s, st, en in zip(sections, starts, ends):
        if en - st <= 1e-9:
            continue                       # 吸着で幅0に潰れた → 除去
        st = out[-1]["endSec"] if out else 0.0  # 連続性を保証
        out.append({**s, "startSec": st, "endSec": en})
    return out


def analyze(path, options: dict | None = None,
            progress: Progress | None = None,
            is_cancelled: Cancelled | None = None) -> dict:
    del options  # MVP ではオプションなし(将来: 拍子ヒント等)

    def report(stage: str, pct: int) -> None:
        if is_cancelled is not None and is_cancelled():
            raise AnalysisCancelled()
        if progress is not None:
            progress(stage, pct)

    report("load", 0)
    y, sr = load_analysis_audio(path)
    dur = float(len(y) / sr)
    warnings: list[str] = []
    if dur < 10.0:
        warnings.append("short-audio")

    report("tempo", 10)
    tempo = track_beats(y, sr)
    if tempo["beatConfidence"] < 0.5:
        warnings.append("low-beat-confidence")
    beats = np.asarray(tempo["beats"], dtype=float)

    report("downbeat", 30)
    phase = estimate_downbeat_phase(y, sr, beats)

    report("key", 40)
    key_global = estimate_key(y, sr)

    report("structure", 50)
    sections = detect_sections(y, sr, beats)
    bars = bar_times(tempo["beats"], phase)
    sections = snap_sections_to_bars(sections, bars, dur)
    per_section = [
        estimate_key(y, sr, s["startSec"], s["endSec"]) for s in sections
    ]

    report("hits", 70)
    hits = detect_hits(y, sr)

    report("envelope", 85)
    envelopes, total_db = compute_envelopes(y, sr)
    silences = detect_silences(total_db)

    analysis = {
        "durationSec": dur,
        "tempoMode": tempo["tempoMode"],
        "bpm": tempo["bpm"],
        "gridOffsetSec": tempo["gridOffsetSec"],
        "beats": tempo["beats"],
        "downbeatPhase": int(phase),
        "tempoMap": tempo["tempoMap"],
        "key": {"global": key_global, "perSection": per_section},
        "sections": sections,
        "hits": hits,
        "silences": silences,
        "envelopes": envelopes,
    }
    report("done", 100)
    return {"analysis": analysis, "warnings": warnings}
