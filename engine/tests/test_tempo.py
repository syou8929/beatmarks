import numpy as np

from synth import click_track, bpm_ramp_track, SR
from beatmarks_engine.tempo import track_beats


def _recall(true_times, got_times, tol):
    got = np.asarray(got_times)
    hit = sum(1 for t in true_times if got.size and np.min(np.abs(got - t)) <= tol)
    return hit / len(true_times)


def test_fixed_bpm_click_track():
    y, true_beats = click_track(128.0, 30.0, offset=0.25)
    res = track_beats(y, SR)
    assert res["tempoMode"] == "fixed"
    assert abs(res["bpm"] - 128.0) <= 128.0 * 0.005          # ±0.5%
    period = 60.0 / res["bpm"]
    # グリッド位相が 0.25s と一致(mod period で比較、±20ms)
    diff = abs((res["gridOffsetSec"] - 0.25 + period / 2) % period - period / 2)
    assert diff <= 0.02
    # グリッドが実拍を ±30ms で網羅
    assert _recall(true_beats, res["beats"], 0.03) >= 0.97
    assert res["tempoMap"] == [{"timeSec": 0.0, "bpm": res["bpm"]}]
    assert res["beatConfidence"] >= 0.7
    assert all(isinstance(b, float) for b in res["beats"])


def test_variable_bpm_ramp():
    y, true_beats = bpm_ramp_track(120.0, 132.0, 60.0)
    res = track_beats(y, SR)
    assert res["tempoMode"] == "variable"
    assert res["bpm"] is None
    assert _recall(true_beats, res["beats"], 0.05) >= 0.9
    assert len(res["tempoMap"]) == len(res["beats"])
    bpms = [p["bpm"] for p in res["tempoMap"]]
    # テンポマップが加速を捉えている(前半平均 < 後半平均)
    assert np.mean(bpms[: len(bpms) // 3]) < np.mean(bpms[-len(bpms) // 3 :])
    times = [p["timeSec"] for p in res["tempoMap"]]
    assert times == sorted(times)


def test_too_short_audio_degrades_gracefully():
    y, _ = click_track(120.0, 1.2)  # 拍3個未満相当
    res = track_beats(y, SR)
    assert res["tempoMode"] in ("fixed", "variable")
    assert isinstance(res["beats"], list)
    assert res["beatConfidence"] == 0.0


def test_short_click_track_is_fixed():
    """持ち越し修正: backtrack量子化ジッタでCVが閾値を跨ぎ、
    8秒の完全な等間隔クリックがvariable誤判定されていた(実測CV=0.02294)。
    判定はbacktrack前の拍列で行うことでfixedに収まる。"""
    y, _ = click_track(120.0, 8.0)
    res = track_beats(y, SR)
    assert res["tempoMode"] == "fixed"
    assert abs(res["bpm"] - 120.0) <= 120.0 * 0.005


def test_silent_audio_returns_empty_gracefully():
    """回帰: 無音でonset_backtrackが空配列例外を出していたガードのピン留め"""
    y = np.zeros(SR * 10, dtype=np.float32)
    res = track_beats(y, SR)
    assert res["beats"] == []
    assert res["beatConfidence"] == 0.0


def test_dense_tempo_dedup_guard():
    """回帰: backtrack後の重複フレームがdedupされゼロ除算しないことのピン留め"""
    y, _ = click_track(140.0, 30.0, offset=0.6)
    res = track_beats(y, SR)  # 例外が出ないこと+拍が単調増加
    beats = res["beats"]
    assert all(b2 > b1 for b1, b2 in zip(beats, beats[1:]))


def test_140bpm_short_click_track_is_fixed():
    """回帰(高BPM境界の外れ値ロバスト化): 140bpm/8秒は backtrack 前拍列の
    末尾に librosa の spurious な1拍が入り、残差が -72ms 突出する
    (実測: 他の残差の3倍以上)。トリム前の直線フィット残差CVは0.0475で
    variable に誤判定されていた。先頭・末尾1拍を除くトリム標準偏差で
    fixed に収まることをピン留めする。"""
    y, _ = click_track(140.0, 8.0)
    res = track_beats(y, SR)
    assert res["tempoMode"] == "fixed"
    assert abs(res["bpm"] - 140.0) <= 140.0 * 0.005


def test_140bpm_offset_click_track_is_fixed():
    """回帰(高BPM境界の外れ値ロバスト化): 140bpm/30秒 offset=0.6 は
    クリップ境界での spurious 拍により末尾2拍の残差が突出し
    (実測: -124ms, -44ms)、トリム前CVは0.0418で variable に誤判定
    されていた(offset=0 では同条件でも0.0156でfixedになる、offset依存の
    境界ケース)。トリム標準偏差 + 閾値0.025で fixed に収まることを
    ピン留めする。"""
    y, _ = click_track(140.0, 30.0, offset=0.6)
    res = track_beats(y, SR)
    assert res["tempoMode"] == "fixed"
    assert abs(res["bpm"] - 140.0) <= 140.0 * 0.005


def test_174bpm_click_track_is_fixed():
    """回帰(高BPM境界の外れ値ロバスト化): 174bpm/30秒は特定の1拍の外れ値
    ではなく、量子化フロア(1フレーム≈23.2msが短い周期に占める割合の増加)
    が多数の拍に分散して乗るケース。トリム前後どちらのCVも0.0195付近で
    旧閾値0.02への実測マージンが0.0005しかなかった。閾値を0.025に
    引き上げたことでマージンを確保できることをピン留めする。"""
    y, _ = click_track(174.0, 30.0)
    res = track_beats(y, SR)
    assert res["tempoMode"] == "fixed"
    assert abs(res["bpm"] - 174.0) <= 174.0 * 0.005
