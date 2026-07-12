# BeatMarks 設計書

- 日付: 2026-07-12
- ステータス: 承認済み(実装計画作成前)
- 名称「BeatMarks」は仮称。リリース前に変更可能。

## 1. 概要

Mac / Windows 向けデスクトップアプリ。音声・動画ファイルをドラッグ&ドロップすると音声解析(BPM・キー・展開・拍/小節・ヒット・音量エンベロープ)が自動で走り、波形エディタ上で結果を確認・手動補正したのち、After Effects をはじめとする映像・3DCG ソフトへ「フレームレート指定済みのマーカーファイル」として書き出せる。

MVP の成功基準: **1曲ドロップ → AE にマーカー入りコンポができるまで 5 分以内。拍グリッドが耳で聴いてズレていないこと。**

## 2. ユーザーと配布方針

- 当面は作者本人の制作ワークフロー効率化のための MVP。
- 将来の一般配布・販売を視野に入れるため、**依存ライブラリは許諾系ライセンス(MIT / BSD / ISC / Apache-2.0)のみ**を使用する。GPL / AGPL 系(aubio、essentia、madmom 等)は採用しない。ffmpeg は LGPL ビルドを別プロセス実行で同梱し、`THIRD_PARTY_LICENSES.md` を自動生成する。
- コード署名・公証・自動アップデート・インストーラの作り込みは Phase 2(MVP では不要)。

## 3. 要求仕様

### 3.1 入力

- 音声: wav / mp3 / aac・m4a / flac / ogg / aiff
- 動画: mp4 / mov / mkv / avi / webm ほか ffmpeg が読める形式(音声トラックを抽出)
- 複数音声トラックがある場合は先頭トラックを使用(MVP)。5.1ch 等はステレオへ自動ダウンミックス。

### 3.2 解析(すべて MVP に含む)

1. **テンポ・拍**: ビートトラッキング。固定 BPM 曲は自動判定してグリッド化、可変テンポ曲は拍列をテンポマップとして保持。
2. **小節頭(ダウンビート)**: 4/4 前提で 1 拍目位相を推定。拍子は UI で変更可(4/4・3/4・6/8)、「1拍目ずらし」補正あり。
3. **キー**: 全体キー+セクション別キー。メジャー/マイナー表記+ Camelot 併記、信頼度付き。
4. **展開(セクション)**: 境界検出+クラスタリングで A/B/C… を自動ラベリング。境界は最寄りの小節頭にスナップ。エネルギー量からサビ/ドロップ候補をフラグ。
5. **ヒット**: 低/中/高の 3 帯域別オンセット検出。全候補を強度付きで返し、しきい値フィルタは UI 側(再解析不要)。
6. **エンベロープ**: RMS ラウドネス(全体+3帯域)を内部 100Hz で保持、書き出し時に指定 fps へリサンプル。

### 3.3 手動補正(MVP に含む)

- グリッドオフセット微調整(±1ms / ±10ms)、BPM 半分/2倍、タップテンポ上書き
- 拍子変更、1拍目ずらし
- セクション境界のドラッグ移動・追加・削除・結合・リネーム・色変更
- 再生中の手動マーカー追加(M キー)、マーカー個別編集・削除
- すべて undo / redo 対応
- 再解析しても手動補正が消えない(§6 データモデル参照)

### 3.4 書き出し

- fps 指定: 23.976 / 24 / 25 / 29.97 / 30 / 50 / 59.94 / 60 +カスタム。NTSC 系は分数(30000/1001 等)で正確に計算。
- 丸めモード: 最近傍 / 切り捨て。フレーム変換は書き出しの瞬間のみ行う。
- 含めるマーカー種別の選択(セクション / 小節 / 拍 / ヒット / 手動 / エンベロープ)。
- 対象(MVP): After Effects(.jsx)、Premiere(FCP XML)、DaVinci Resolve(マーカー EDL)、Blender(.py)、汎用 JSON / CSV / MIDI。
- 対象(Phase 2): C4D / Houdini / Maya / 3dsMax / Unity / Unreal。
- 複数ターゲット同時書き出し可。

### 3.5 プロジェクト保存

- `.bmk` ファイル(実体は JSON)。解析生データ+手動補正+UI 状態を保存し、開き直して作業再開できる。

## 4. アーキテクチャ

3 プロセス構成:

| プロセス | 技術 | 責務 |
|---|---|---|
| Electron メイン | TypeScript / Node | D&D 受付、ffmpeg 実行、エンジン起動・死活監視、エクスポートファイル書き出し、プロジェクト保存 |
| レンダラー | React + TypeScript | 波形エディタ UI、再生(Web Audio)、編集操作、エクスポート設定 |
| 解析エンジン(サイドカー) | Python(PyInstaller で単一バイナリ化) | 音声解析一式。ユーザーの Python インストール不要 |

- メイン ↔ レンダラー: 型付き Electron IPC。
- メイン ↔ エンジン: stdio 上の JSON-RPC 2.0(NDJSON)。API は `analyze(audioPath, opts)` / `cancel(jobId)` / `ping` / `version`。進捗は notification で随時送出。
- ffmpeg: 静的バイナリ同梱、別プロセス実行。

### データフロー

1. D&D → メインが ffmpeg で再生用 WAV(44.1kHz ステレオ)と解析用 WAV(22.05kHz モノ)を抽出
2. エンジンへ解析依頼 → 進捗をレンダラーへ中継(進捗バー)
3. 結果 JSON をプロジェクトモデルへ格納 → 波形+オーバーレイ表示
4. ユーザー編集は edits として記録(undo/redo)
5. エクスポート時に fps 設定を適用し、各エクスポータ(純関数)がテキスト生成 → メインがファイル書き出し
6. `.bmk` 保存・復元

### リポジトリ構成

```
beatmarks/
  app/                 # Electron + React (TypeScript)
    src/main/          #   メインプロセス(ipc, ffmpeg, engine 管理, ファイル I/O)
    src/renderer/      #   React UI(エディタ)
    src/shared/        #   型定義・マーカーモデル・エクスポータ(純関数)
  engine/              # Python 解析エンジン
    beatmarks_engine/  #   解析パイプライン
    tests/             #   pytest
  docs/
    superpowers/specs/ #   設計書
    mockups/           #   UI モックアップ(editor-mockup.html)
    manual-qa.md       #   実ソフト読み込みチェックリスト(Phase 1 で作成)
```

## 5. 解析エンジン詳細

- 依存: numpy / scipy / librosa(ISC)/ soundfile。librosa の numba 依存は PyInstaller の既知レシピで同梱する。
- 入力正規化: 解析は 22.05kHz モノラル。
- **テンポ・拍**: オンセット強度+動的計画法ビートトラッキング。拍間隔の変動係数が閾値(目安 2%)未満なら「固定 BPM」— 中央値 BPM でグリッド生成し最小二乗でオフセット推定。閾値以上なら「可変」— 拍列をそのまま採用しテンポマップ(拍ごとの瞬間 BPM)を導出。
- **ダウンビート**: 拍同期の低域エネルギー・クロマ変化の 4 位相自己相関で 1 拍目位相を推定。拍子変更・位相ずらしは拍列が不変なため UI 側で再割当できる(エンジン再実行不要)。
- **キー**: クロマ(CQT)の時間平均 × Krumhansl-Schmuckler 24 テンプレート相関。信頼度 = 1 位と 2 位の相関差。セクション別キーは区間平均で同様に。
- **展開**: ビート同期特徴(MFCC +クロマ)→ 自己相似行列 → ノベルティ検出で境界候補 → クラスタリングでラベル割当 → 境界を小節頭へスナップ。RMS 上位クラスタに「サビ/ドロップ候補」フラグ。
- **ヒット**: 3 帯域バンドパス(目安: 低 <150Hz / 中 150–2000Hz / 高 >5kHz)→ 帯域別オンセット検出。強度付き全候補を返す。
- **エンベロープ**: RMS(全体+3帯域)10ms ホップ、dB 正規化(−60〜0dB → 0〜1)。
- パフォーマンス目標: 4 分楽曲を Apple Silicon で 15 秒以内。
- 拡張性: `AnalyzerBackend` インターフェースで実装を差し替え可能にし、Phase 2 でニューラル高精度モード(MIT 系モデルのみ、追加ダウンロード形式)を追加できるようにする。

## 6. データモデル

時刻は常に **秒(float)** で保持。フレーム変換はエクスポート時のみ。

```ts
type MarkerType = 'beat' | 'bar' | 'section' | 'hit' | 'custom';

interface Fps { num: number; den: number }          // 例: 29.97 = {num:30000, den:1001}
interface KeyGuess { name: string; camelot: string; confidence: number }  // 例: "E minor", "9A", 0.86

interface Marker {
  id: string;
  timeSec: number;
  type: MarkerType;
  label: string;
  color: string;
  source: 'auto' | 'user';
  meta?: { strength?: number; band?: 'low'|'mid'|'high'; durationSec?: number };
}

interface AnalysisResult {          // エンジンが返す生データ(不変)
  tempoMode: 'fixed' | 'variable';
  bpm?: number;                     // fixed のとき
  gridOffsetSec: number;
  beats: number[];                  // 拍時刻列
  downbeatPhase: 0|1|2|3;
  tempoMap: { timeSec: number; bpm: number }[];
  key: { global: KeyGuess; perSection: KeyGuess[] };
  sections: { startSec; endSec; label; clusterId; chorusCandidate: boolean }[];
  hits: { timeSec; band; strength }[];
  envelopes: { sampleRateHz: 100; total: number[]; low: number[]; mid: number[]; high: number[] };
}

interface EditState {               // 手動補正(生データと分離)
  gridOffsetDeltaSec: number;
  bpmOverride?: number;             // タップテンポ / 半分 / 2倍
  timeSig: '4/4' | '3/4' | '6/8';
  downbeatShift: number;
  sectionOverrides: SectionEdit[];  // 移動・追加・削除・リネーム・色
  hitThreshold: { low: number; mid: number; high: number };
  customMarkers: Marker[];
  deletedMarkerIds: string[];
}

interface ProjectFile {             // .bmk (JSON)
  version: 1;
  mediaPath: string;
  mediaHash: string;                // 音声内容のハッシュ(差し替え検知)
  analysis: AnalysisResult;
  edits: EditState;
  ui: { fps: Fps; zoom: number; ... };
}
```

- 表示・書き出しに使う最終マーカー列は `analysis + edits` から**導出**する。再解析しても edits を再適用できるため手動補正が消えない。
- undo/redo は EditState へのコマンドパターンで実装。
- fps は分数で扱う(例 29.97 = 30000/1001)。`frame = round(timeSec × fps)` または `floor`。丸めは都度計算のため累積誤差なし。

## 7. UI 設計

モックアップ: `docs/mockups/editor-mockup.html`(承認済み。画面構成はこのまま実装)

- 画面は 2 つ: **ドロップ画面**(D&D 受付+解析進捗)と**エディタ画面**。
- エディタ構成(上→下): ①トランスポート(再生/ループ/タイムコード@指定fps、**メトロノーム音トグル**、タップテンポ、手動マーカー)②グリッド補正バー(BPM・オフセット nudge・拍子・1拍目ずらし・キー表示)③オーバービュー(曲全体、色分け、表示窓ドラッグ)④セクション帯(境界ドラッグ/ダブルクリックでリネーム)⑤メイン波形(拍/小節グリッド+小節番号、ズーム可)⑥ヒットレーン(帯域別+感度スライダー)⑦マーカー一覧テーブル(クリックでジャンプ、種別フィルタ)+書き出しパネル。
- 再生: Web Audio API。メトロノームは拍でクリック合成音(小節頭は高いピッチ)を重ねる — グリッド検証の要。
- 波形描画: 自前 Canvas。ピークデータはワーカーでプリ計算し、ズームレベル別にキャッシュ。60fps 維持。
- ショートカット: Space(再生)/ M(マーカー)/ ←→(拍シーク)/ Shift+←→(小節シーク)/ ⌘Z・⌘⇧Z / 1〜4(レーン表示切替)。
- 文言は日本語(MVP)。文字列は定数ファイルに分離し将来英語化可能に。

## 8. エクスポータ仕様

すべて「マーカーモデル+設定 → 文字列」の**純関数**として `app/src/shared/exporters/` に実装(ゴールデンテスト容易)。

| ターゲット | 形式 | 内容 |
|---|---|---|
| 正規 JSON | `.json` | 全マーカー+テンポマップ+キー+エンベロープ+設定。秒・フレーム・タイムコード併記。他ツール連携の基準形式 |
| After Effects | `.jsx` (ExtendScript) | 実行すると新規コンポ(名前=曲名、fps=指定、尺=曲長)を作成し音声を配置。コンポマーカー(既定)/レイヤーマーカー(スクリプト内フラグ)。セクションは duration 付き。エンベロープは `BM_Envelopes` ヌルのスライダーへ `setValuesAtTimes` で焼き込み。AE 2019+ 対応 |
| Premiere | FCP XML (xmeml v4) | マーカー付きシーケンス。NTSC 属性を正しく設定 |
| Resolve | マーカー EDL | 「タイムライン > 読み込み > マーカー」互換の CMX3600 風 EDL(色・ラベル付き) |
| Blender | `.py` | シーン fps(fps / fps_base)設定+ `timeline_markers` 生成+音声ストリップ配置(オプション) |
| CSV | `.csv` | `time_sec, frame, timecode, type, label, color, strength` |
| MIDI | `.mid` (format 1) | マーカー=メタイベント、拍/小節頭=ノート(C1/C2)、ヒット=帯域別ノート、テンポマップ=テンポイベント。DAW 連携用 |

Phase 2: C4D `.py` / Houdini `.py` / Maya `.py` / 3dsMax `.ms` / Unity `.cs`+JSON ローダー / Unreal `.py`(Sequencer)。いずれも同じ内部モデルからのテンプレート生成。

## 9. エラー処理

方針: **解析は失敗してもアプリは落ちない。**

- 音声抽出不可(非対応/破損/DRM): ffmpeg のエラーを捕捉し「このファイルから音声を抽出できませんでした」+形式ヒントを表示。
- 長尺(15 分超): 解析時間の目安を出して続行確認。1 時間級のストリーミング分割解析は Phase 2。
- 無音・超短尺(<10 秒)・極端な入力: エンジンが `warnings` 付きで部分結果を返し、UI にバッジ表示。
- エンジンプロセス異常終了: メインが死活監視、自動再起動、実行中ジョブは失敗として UI 通知。ログは electron-log でファイル保存(エンジンは stderr に構造化ログ)。
- BPM 信頼度が低い: 「信頼度低」バッジ+タップテンポへの誘導。
- 書き出し失敗(権限・パス): ダイアログでリトライ/場所変更。
- AE スクリプト実行側: 対象が見つからない場合は新規作成にフォールバックする防御的 ExtendScript にする。

## 10. テスト計画

| 層 | ツール | 内容 |
|---|---|---|
| 解析エンジン | pytest | 合成クリック音(BPM 60–180、既知オフセット、可変テンポランプ)で拍精度 ±30ms・BPM ±0.5% をアサート。既知コード進行の合成音でキー正解。無音/短尺/ノイズのエッジケース |
| エクスポータ | vitest | ゴールデンファイル(スナップショット)比較。29.97fps で 10 分曲でも丸め誤差が累積しないことの境界テスト |
| UI ロジック | vitest | グリッド計算、edits 適用、undo/redo、fps 変換 |
| E2E | Playwright (Electron) | フィクスチャ wav を D&D → 解析 → .jsx 書き出しのスモーク |
| 実ソフト検証 | 手動 | AE / Resolve / Premiere / Blender への読み込みチェックリスト(`docs/manual-qa.md`) |

## 11. 非機能要件

- 対応 OS: macOS 12+(arm64 / x64)、Windows 10+(x64)。ビルドは electron-builder。
- 完全オフライン動作。テレメトリなし。
- アプリサイズ想定: 250–400MB(Electron + Python エンジン + ffmpeg)。
- UI 60fps 維持(波形はワーカー+キャッシュ)。

## 12. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| 古典手法のダウンビート精度 | 小節マーカーが 1〜2 拍ズレる | 「1拍目ずらし」ワンクリック補正+ Phase 2 ニューラルモード |
| PyInstaller × librosa/numba の同梱 | ビルド失敗・起動不良 | 既知レシピ採用、CI で Mac/Win 両ビルドのスモークテスト |
| Windows 実機検証(作者は Mac) | Win 版の品質 | Phase 1 は Mac 優先。Win は CI ビルド+後日実機確認 |
| 長尺ファイルのメモリ | 1h DJ mix でクラッシュ | 15 分超は警告、分割解析は Phase 2 |
| 展開解析の主観性 | 自動ラベルが意図と違う | 境界・ラベルは全編集可能。自動は「下書き」と位置づけ |

## 13. フェーズ計画

- **Phase 1(MVP)**: D&D → 全解析 → エディタ(モックの範囲)→ 書き出し(AE / Premiere / Resolve / Blender / JSON / CSV / MIDI)→ `.bmk` 保存。Mac(Apple Silicon)ビルド優先、Win ビルドも CI で生成。
- **Phase 2**: 残り DCC エクスポータ(C4D / Houdini / Maya / Max / Unity / UE)、複数ファイルのバッチ処理、ニューラル高精度モード、配布準備(署名・公証・自動アップデート)、長尺分割解析。
