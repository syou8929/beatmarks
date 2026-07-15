# BeatMarks 計画③c: パッケージング+CI+E2E 実装計画

> **実行環境の前提(重要)**: この計画は **Claude Code 環境(ユーザーのローカルMac)での実行を前提**とする。理由: ③a/③b を実行したクラウドコンテナでは Electron バイナリが起動できず(GUI無し・ダウンロードもプロキシで不可)、パッケージングと E2E の検証がブラインドになる。ローカルなら electron-builder / Playwright / 実 GUI を即座に回せる。CI(GitHub Actions)が Windows 側を担保する。
> **形式**: ③a/③b と違い、本計画は「完全コード転写型」ではなく「アーキテクチャ+チェックリスト型」。実行者(Claude Code)は実機フィードバックを見ながら反復できるため。ただしリスクの高い設定ファイルは骨子を明記した。

**Goal:** BeatMarks を Mac(arm64優先)/Windows(x64) の配布可能なアプリに固め、GitHub Actions で両OSビルド+テスト+E2Eスモークを自動化する。

**前提状態:** feat/app-core = fdff1a9(③a+③b、app vitest 482 / engine pytest 59 全緑)。台帳 `.superpowers/sdd/progress.md` の「③c 権威的持ち越しリスト」が本計画の入力。

---

## Task 1: エンジンとffmpegの同梱進備

- **エンジン**: PyInstaller onefile は計画①で検証済み(Linux 138MB)。Mac/Win 用に `engine/engine.spec` をOS毎にビルドし `app/resources/engine/<platform>/beatmarks-engine(.exe)` へ配置するスクリプト(`scripts/build-engine.sh` / `.ps1`)。macOS は arm64 ネイティブでビルド(Rosetta回避)。
- **ffmpeg/ffprobe**: **LGPLビルド必須**(GPL構成要素 libx264 等を含む static build は不可 — ライセンス方針 docs/license-comparison.md 参照)。候補: BtbN の `ffmpeg-master-latest-<os>-lgpl` リリース、または自前 `--disable-gpl --disable-nonfree` ビルド。音声デコードのみなので LGPL 構成で十分。
  - **検収項目(③a T3持ち越し)**: 採用ビルドの ffprobe で mp4/mov のストリーム `title` タグが回収できるか確認(6.1.1 では不可だった)。回収不可でも "Track N" フォールバックで機能はする — 結果を docs に記録。
- **paths.ts**: パッケージ時は `process.resourcesPath` 配下を解決するよう分岐を実装(③aで環境変数オーバーライドは実装済み。`app.isPackaged` で切替)。dev の Windows は `.venv/Scripts/python.exe`(持ち越し)。
- **テスト**: paths 解決のユニットテスト(isPackaged モック)。

## Task 2: electron-builder 構成

- `app/electron-builder.yml`: appId `com.beatmarks.app`(仮)、productName BeatMarks、mac { target: dmg+zip, arch: arm64(+x64は後), category: public.app-category.music }、win { target: nsis, arch: x64 }、`extraResources` で engine/ffmpeg/ffprobe を同梱、`asarUnpack` は不要(バイナリは extraResources 側)。
- 署名/公証は **Phase 2**(spec §13) — 未署名ビルドでよい(Mac は右クリック開放、Win は SmartScreen 警告を README に記載)。
- `THIRD_PARTY_LICENSES.md` 自動生成: `license-checker`(npm, MIT)等で npm 依存を出力+ Python 依存(constraints.txt ベースで pip-licenses)+ ffmpeg(LGPL文面とソース入手先URL — LGPL遵守に必須)+ librosa/numpy 等。ビルドに組み込み。
- **検証**: ローカル `npx electron-builder --mac` で .dmg 生成 → 起動 → D&D→解析→書き出しの手動スモーク。

## Task 3: E2E スモーク (Playwright + Electron)

- `app/e2e/` に Playwright の Electron ドライバ構成(`_electron.launch({ args: [out/main] })` — パッケージ前の electron-vite ビルド出力で起動。CI の Linux では xvfb-run)。
- **必須シナリオ(最終レビュー指定)**:
  1. フィクスチャ wav を開く(D&Dの代わりにIPC直叩き or input経由)→ 解析完了 → エディタ表示
  2. **1⌘Z=1undo**(グリッド編集→⌘Z→編集が1段だけ戻る — メニュー二重発火の回帰)
  3. ホイールズーム(カーソル中心・ページスクロールしない)
  4. Space再生+メトロノームON(AudioContext実動作 — 音声出力の検証は状態のみ)
  5. .jsx 書き出し → ファイル生成+ゴールデン一致
  6. .bmk 保存 → 再オープン(再抽出+hashMismatchなし)
  7. nudgeキーリピート挙動の確認(undo段数)
  8. ソースタブ切替で波形/音声が変わらないこと(現仕様の意図確認 — 変えるべきなら issue 化)
- エンジンは実バイナリ(Task 1 の成果物)を使用 — E2E がパッケージ構成の統合テストを兼ねる。

## Task 4: GitHub Actions

- `.github/workflows/ci.yml`: push/PR で (a) lint相当: tsc×2 (b) app vitest (c) engine pytest(uv/pip + constraints.txt) — ubuntu で高速に。
- `.github/workflows/build.yml`: tag or 手動トリガで macos-14(arm64) / windows-2022 マトリクス: エンジンPyInstaller → ffmpeg取得(LGPL、SHA256固定) → electron-builder → 成果物 artifact upload。E2E は ubuntu(xvfb)+ mac で実行。
- キャッシュ: pip/npm/PyInstaller。Windows の pytest は初回から通るはず(パス処理は join ベース — 最終レビュー確認済み)だが、失敗時は原因を記録して Windows 専用修正タスクを起こす。

## Task 5: UI磨き+残課題バンドル(台帳D項)

台帳「③c 権威的持ち越しリスト D」の全項目を1タスクで消化(各項目は小さい): freeBeforeトグル / bpmOverrideクリアUI / effectiveBpm述語統一 / showDeleted件数+ソース列 / failed[].path正規化 / wavcues重複抽出キャッシュ / act()警告解消 / recent剪定 / menu.ts文言(mainから参照可能な共有stringsへ) / SaveOutcome型化 / アンカースナップ project.fps 化 / WAV二重読み解消 / followPlayhead 実装or削除 / SET_TIME_UNIT削除 / EngineClient診断ログ+NDJSON行バッファ上限。
仕上げに docs/manual-qa.md 完全版(manual-qa-editor.md を核に、実ソフト読み込みチェックリスト: AE/Resolve/Premiere/Blender/REAPER/Logic — spec §10)。

## 完了条件(計画③c)

- ローカル Mac: .dmg が生成・起動し、D&D→解析→編集→書き出し→保存→再オープンが手動で通る
- CI: 両workflow緑、Mac/Win 成果物がartifactに載る、E2E 8シナリオ緑
- THIRD_PARTY_LICENSES.md が同梱され、GPL/AGPL 非含有を最終確認
- 台帳D項全消化、manual-qa.md 完成

## この計画がやらないこと(Phase 2)

署名・公証・自動アップデート / Mac App Store / C4D・Houdini・Maya・3dsMax・Unity・UE エクスポータ / Ableton 実験 / バッチ処理 / ニューラルモード / 長尺分割解析 / 略称カスタマイズ
