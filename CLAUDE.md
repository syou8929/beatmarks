# BeatMarks — CLAUDE.md

音声/動画をD&Dすると BPM・KEY・展開・ヒット・静寂を解析し、DAWライクなエディタで補正して、AE/Premiere/Resolve/Blender/DAW 等 11形式のマーカーファイルを書き出す Mac/Win デスクトップアプリ(Electron + Python)。

## コマンド

```bash
# アプリ(app/)
cd app && npx vitest run                 # 現在 482 テスト / 61 ファイル 全緑が正常
npx tsc --noEmit                          # renderer/shared
npx tsc -p tsconfig.node.json --noEmit    # main/preload/shared
npx electron-vite build                   # バンドル(実行はしない)
npm run dev                               # GUI起動(electron-vite dev)

# エンジン(engine/)
cd engine && source .venv/bin/activate    # 初回: python3.11 -m venv .venv && pip install -e ".[dev]" -c constraints.txt
pytest -q                                 # 現在 59 passed が正常
```

## アーキテクチャ

- `engine/` — Python 3.11 + librosa。JSON-RPC 2.0 (NDJSON/stdio) サーバー。配布時は PyInstaller onefile
- `app/src/shared/` — **Electron非依存の純関数ライブラリ**(型・グリッド導出・マーカー導出・11エクスポータ・タイムベース)。純度テストが監視。ゴールデン21件は `__tests__/golden/`(**不変が原則**。正当な変更のみ `UPDATE_GOLDEN=1` で再生成し理由を記録)
- `app/src/main/` — ffmpeg抽出・EngineClient・analyzeMedia・projectStore(.bmk)・exportWriter・menu。依存はDI(`MainDeps`)
- `app/src/preload/` — contextBridge で `IpcApi` のみ公開
- `app/src/renderer/` — React 19。`state/store.ts`(useReducerドメイン状態+undo/redo)と `state/viewStore.ts`(表示状態、undo対象外)の二層。UI文言は **全て `strings.ts`**

## 開発プロセス(このリポジトリの流儀)

1. 計画書駆動: `docs/superpowers/plans/` の計画書に従いタスク単位で実装。**各タスク: TDD(失敗テスト→実装→全緑)→1コミット→コードレビュー→修正コミット→計画書へ「レビュー後の修正」注記**
2. superpowers スキル(subagent-driven-development 等)が使えるなら使う。使えなくても上記サイクルは維持
3. コミットは日本語 conventional 風(`feat(app): …` / `fix(engine): …`)。コミットメッセージ末尾のトレーラーは現環境の規約に従う
4. 検証なしに完了と言わない(テスト実行の出力を確認してから報告)

## 頻出バグクラス(全て過去に実際に踏んだ — レビュー時必ず確認)

- **位置添字 vs 元添字**: dispatch する index は必ず「元の analysis 配列の添字」。フィルタ/ソート後の表示位置を渡さない(marker ID から `sectionIndexFromId` 等で解決)。二重解決にも注意(コンポーネントが解決済みの値を親で再解決しない)
- **React 19 の passive listener**: JSX `onWheel` + `preventDefault()` は無効。ネイティブ非passiveリスナー(`ref`+`useEffect`+`{passive:false}`)を使う
- **CSS shorthand/longhand 衝突**: style オブジェクトの spread で `border` を `borderColor` が上書きする類はトグル再レンダーで壊れる。longhand で統一
- **blur の亡霊発火**: 編集確定/取消は `activeRef` セッションガード付き(NumericField/SectionBand 参照)
- **EDIT_APPLIED は浅マージ**: ネストキー(hitThreshold 等)は全フィールドを渡す。明示的 `undefined` はクリア意味
- **⌘Z の所有権はレンダラー単独**(menu.ts の undo/redo に accelerator を付けない — テキスト入力ガードのため)

## ライセンス方針(docs/license-comparison.md)

GPL/AGPL 禁止。LGPL は動的リンク/別プロセスのみ可(ffmpeg は**LGPLビルド**を別プロセス起動、libsndfile/soxr は動的リンク)。ビルド専用ツールは GPL-with-exception 可(PyInstaller 承認済み)。新規依存追加時はライセンス確認必須。

## 現在の状態と次の仕事

- 完了: 計画①(エンジン)②(エクスポータ)③a(アプリコア)③b(エディタUI+書き出し+.bmk)。ブランチ `feat/engine`→`feat/exporters`→`feat/app-core` 全push済み
- **GUI は一度も実起動されていない**(開発はヘッドレスなクラウドで実施)。E2E・パッケージング・Windows は未検証
- **次: 計画③c** — `docs/superpowers/plans/2026-07-13-packaging-ci.md`(同梱準備→electron-builder→E2E→GitHub Actions→UI磨きバンドル)。持ち越し課題の権威的リストは同計画書の末尾
- 経緯・設計判断は各計画書の「レビュー後の修正」注記に全記録。設計書: `docs/superpowers/specs/2026-07-12-beatmarks-design.md`、モック: `docs/mockups/editor-mockup.html`
