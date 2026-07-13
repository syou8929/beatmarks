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
- 高BPM境界の外れ値ロバスト化(2026-07-13 followup)。上の直線フィット残差
  CV は、高BPMの短尺クリップで依然マージンが薄い/逆転する2種の要因が
  残っていた: (a) 量子化フロアの相対上昇 — 1フレーム(hop/sr≈23.2ms)は
  絶対時間で一定だが周期が短いほど周期に対する比率が増えるため、174bpm/30秒
  ではトリム前後どちらでも CV≈0.0195〜0.0196 で閾値0.02までの実測マージンが
  0.0005しかない(多数の拍に分散した量子化ノイズであり特定1拍の外れ値では
  ないため、トリムしてもほぼ変化しない)。(b) beat_track がクリップ境界近くで
  spurious な1拍を拾い残差が突出する — 実測: 140bpm/8秒は末尾拍の残差が
  -72.2ms と他の残差(最大でも±23ms程度)の3倍以上に達し、トリム前CV=0.0475で
  variable に誤判定される。140bpm/30秒は offset に応じて同種の境界拍が
  出たり消えたりし(実測: offset=0.6でCV=0.0418、offset=0でCV=0.0156)、
  fixed/variable の判定が offset に対して不安定だった。
  MAD(1.4826*median(|resid-median(resid)|))とトリム標準偏差(残差最大1点を
  除外/先頭・末尾1拍ずつを除外)を全ケース(上記(a)(b)に加え
  120→124bpmランプ15/30/60秒・120→132bpmランプ60秒・120bpm/8秒)で比較実測。
  MAD は量子化フロア由来のノイズ(ほぼ一様分布)にガウス仮定の1.4826倍率を
  適用するとかえって過大評価になり、174bpm/30秒のCVが0.0195→0.0250へ悪化し
  他の高BPM fixedケースも0.025を超えたままで不採用。先頭・末尾1拍を除いた
  トリム標準偏差が全候補中で最も広いマージン(fixed側最悪値0.0230、drift側
  最悪値0.0326、両者の差0.0096)を達成したため採用した。
  (実装: `judge_resid[1:-1]` — `judge` は上のガードにより常に4拍以上なので
  トリム後も2拍以上残ることが保証される。)
  この結果 FIXED_CV_THRESHOLD を 0.02→0.025 に変更した(トリム後の最悪fixed
  ケース[140bpm/30秒 offset0.6]が0.0230で0.02からの差が0.003程度しかなく、
  トリムだけでは0.02ラインに寄り切れなかったため)。0.025は真のドリフト最小
  ケース(+4bpm/15秒ランプ、トリム後CV=0.0326)まで0.0076のマージンを残す
  控えめな引き上げであり、これ以上(目安0.03超)は真のテンポ変化との分離が
  細くなるため避ける。
- variable モードの beatConfidence(= clip(1 - cv*10, 0, 1))は、テンポ変化が
  大きいほど 0 に収束する設計であり意図的。`analyze.py` は
  `beatConfidence < 0.5` で `"low-beat-confidence"` 警告を出すため、強い
  ドリフト/ステップテンポの曲でこの警告が発火するのはバグではなく想定動作。
"""
import librosa
import numpy as np
import scipy.signal

HOP = 512
FIXED_CV_THRESHOLD = 0.025  # 根拠はモジュール docstring 実装メモ(2026-07-13 followup)参照


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
    # backtrack 済みのまま使う。backtrack+unique は要素数を減らすことしか
    # できないため raw_beats は常に len(beats) 以上(=4以上、上のガードで
    # 保証済み)であり、フォールバックは不要。
    judge = raw_beats
    judge_idx = np.arange(len(judge))
    judge_period, judge_intercept = np.polyfit(judge_idx, judge, 1)
    judge_resid = judge - (judge_intercept + judge_idx * judge_period)
    # 先頭・末尾1拍はクリップ境界での spurious 検出により残差が突出しやすい
    # ため、スケール推定(トリム標準偏差)から除外する(理由・比較実測は
    # モジュール docstring 実装メモを参照)。judge は常に4拍以上なので
    # トリム後も2拍以上残る。
    trimmed_resid = judge_resid[1:-1]
    cv = float(np.std(trimmed_resid) / judge_period)
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
