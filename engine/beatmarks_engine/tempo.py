"""テンポ・拍トラッキング。

- librosa の動的計画法ビートトラッカーで拍列を得る
- 拍列の等間隔グリッドへの適合度(変動係数 CV)< FIXED_CV_THRESHOLD なら「固定BPM」:
  最小二乗でグリッド(周期+位相)をフィットし、等間隔グリッドを再生成
- それ以外は「可変」: 拍列をそのまま採用し、拍ごとの瞬間BPMをテンポマップ化

実装メモ(検証済みの調整、詳細は task-3-report.md 参照):
- `beat_track(..., trim=True)`(librosa既定値): クリックトラック先頭の弱い/不整合な
  拍を1つ拾ってしまうと IBI の変動係数が跳ね上がり fixed 判定を誤るため、
  弱い先頭・末尾の拍を切り詰める既定動作を有効にする。
- `onset.onset_backtrack`: onset strength のピークはスペクトルフラックスの
  平滑化により実際のオンセットよりも系統的に遅れる(実測で平均約20ms)。
  各拍フレームをオンセット強度の直前の極小点まで巻き戻すことで
  グリッド位相(gridOffsetSec)の系統誤差を吸収する。
  巻き戻し後、隣接する拍が同じ極小点に収束して重複フレームになることがある
  (実測: 密なテンポでまれに発生)。重複を残すと拍間隔が0になり、可変テンポの
  瞬間BPM計算 `60.0 / ibis` がゼロ除算になるため、巻き戻し後に一意化する。
  無音区間など拍が1つも検出できない場合 `beat_frames` は空配列になりうるため
  (実測: 無音10秒で発生)、巻き戻しは拍が存在するときだけ行う
  (`onset_backtrack` は空配列を渡すと例外を送出する)。
- fixed/variable 判定は backtrack 前の拍列で行う(量子化ジッタ対策、2026-07-13)。
  判定指標は「拍列に対する最小二乗グリッド(直線)フィットの残差」の変動係数
  (std(残差) / フィット周期)を用いる。連続区間 diff の std/mean をそのまま
  使うと、1拍あたりのフレーム数が整数にならないテンポ(例: 120bpm,
  hop_length=512, sr=22050 では 21.53 フレーム/拍)で beat_track 自身の
  フレーム量子化が ±1 フレームの交番パターンを生み、8秒程度の短尺だと
  それだけで CV が閾値を超えて variable に誤判定される(実測: backtrack前/後
  どちらの拍列で diff ベース CV を計算しても CV≈0.02294 で同じ値になり、
  backtrack前後の切替だけでは解消しない)。直線フィット残差は量子化による
  ±1フレームの往復ノイズがあっても発散しない一方、真のテンポ変化(実測:
  120→132bpm ランプで CV が 0.033 から 0.43 に拡大)には従来以上に敏感になる。
"""
import librosa
import numpy as np
import scipy.signal

HOP = 512
FIXED_CV_THRESHOLD = 0.02


def _empty_result(beats: np.ndarray) -> dict:
    return {
        "tempoMode": "fixed",
        "bpm": None,
        "gridOffsetSec": float(beats[0]) if beats.size else 0.0,
        "beats": [float(b) for b in beats],
        "tempoMap": [],
        "beatConfidence": 0.0,
    }


def track_beats(y: np.ndarray, sr: int) -> dict:
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    _tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=sr, hop_length=HOP, trim=True
    )
    raw_beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    if beat_frames.size:
        beat_frames = np.unique(librosa.onset.onset_backtrack(beat_frames, onset_env))
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)

    if len(beats) < 4:
        return _empty_result(beats)

    # 固定/可変判定は backtrack 前の拍列(raw_beats)で行う。位置(beats)は
    # backtrack 済みのまま使う。判定指標は直線グリッドフィット残差の変動係数
    # (理由はモジュール docstring 実装メモを参照)。
    judge = raw_beats if len(raw_beats) >= 4 else beats
    judge_idx = np.arange(len(judge))
    judge_period, judge_intercept = np.polyfit(judge_idx, judge, 1)
    judge_resid = judge - (judge_intercept + judge_idx * judge_period)
    cv = float(np.std(judge_resid) / judge_period)
    confidence = float(np.clip(1.0 - cv * 10.0, 0.0, 1.0))

    ibis = np.diff(beats)  # 可変モードのテンポマップは実位置(backtrack後)基準のまま

    if cv < FIXED_CV_THRESHOLD:
        idx = np.arange(len(beats))
        period, intercept = np.polyfit(idx, beats, 1)
        bpm = 60.0 / float(period)
        offset = float(intercept % period)
        dur = len(y) / sr
        n = int(np.floor((dur - offset) / period)) + 1
        grid = offset + np.arange(max(n, 0)) * period
        grid = grid[grid < dur]
        return {
            "tempoMode": "fixed",
            "bpm": float(bpm),
            "gridOffsetSec": offset,
            "beats": [float(t) for t in grid],
            "tempoMap": [{"timeSec": 0.0, "bpm": float(bpm)}],
            "beatConfidence": confidence,
        }

    # 可変テンポ: 拍ごとの瞬間BPM(中央値フィルタで平滑化)
    inst_bpm = 60.0 / ibis
    if len(inst_bpm) >= 5:
        inst_bpm = scipy.signal.medfilt(inst_bpm, kernel_size=5)
    inst_bpm = np.append(inst_bpm, inst_bpm[-1])  # 最後の拍にも値を持たせる
    tempo_map = [
        {"timeSec": float(t), "bpm": float(b)} for t, b in zip(beats, inst_bpm)
    ]
    return {
        "tempoMode": "variable",
        "bpm": None,
        "gridOffsetSec": float(beats[0]),
        "beats": [float(b) for b in beats],
        "tempoMap": tempo_map,
        "beatConfidence": confidence,
    }
