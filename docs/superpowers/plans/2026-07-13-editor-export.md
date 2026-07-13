# BeatMarks 計画③b: エディタUI+書き出し+.bmk統合 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 承認済みモック(docs/mockups/editor-mockup.html)準拠のDAWライクなエディタ本UI、書き出しパネル+writeExports本実装、.bmkメニュー統合(再オープン戦略含む)を完成させ、BeatMarksをエンドツーエンドで使える状態にする。

**Architecture:** ③aの土台(型付きIPC・EngineClient・analyzeMedia・projectStore・rendererストア・playback)の上に、レンダラーのエディタ層を「純ロジック(vitest対象)+薄いReactコンポーネント(jsdom+RTLで要点のみ)」の二層で構築。波形はWorkerでピークmipmapをプリ計算し自前Canvasで描画。書き出しはmainプロセスのwriteExportsが共有エクスポータ(計画②)を呼ぶ。パッケージング/CI/E2Eは**計画③c**(別計画)。

**Tech Stack:** TypeScript strict / React 19 / electron-vite / vitest 3.2.7 (+jsdom, @testing-library/react ^16 を本計画 Task 1 で追加) / Web Audio / Canvas 2D / Web Worker

## Global Constraints

- ライセンス方針: GPL/AGPL 禁止。新規 runtime 依存は原則追加しない(devDeps の jsdom/@testing-library は MIT で可)
- shared/ は Electron 非依存の純関数を維持(計画②の純度テストが監視)
- renderer は Node API 直接使用禁止(IPC 経由のみ)。tsconfig の `types:["node"]` を本計画 Task 1 で除去
- 文言は日本語、`app/src/renderer/strings.ts` に定数として分離(§7)
- コミットは1タスク1コミット(レビュー対応は別コミット)、メッセージは日本語 conventional 風(feat/fix/test/docs)
- 各タスクは TDD: 失敗するテスト → 最小実装 → 全テスト緑 → コミット
- 検証コマンド(全タスク共通): `cd /home/claude/beatmarks/app && npx vitest run && npx tsc --noEmit && npx tsc -p tsconfig.node.json --noEmit && npx electron-vite build`
- **Electron バイナリはこの環境で実行不可** — GUI 動作確認は③cの E2E/CI で担保。ここではビルド成功+ロジックテストまで
- ③a最終レビューのハンドオフ(台帳 .superpowers/sdd/progress.md 記載)を本計画が全て消化する:
  - キャンセルは main 側で `{cancelled:true}` センチネルに変換(エラー同一性/メッセージマッチ禁止)+ AnalyzeCancelledError.name 設定 (Task 1)
  - .bmk から playbackWavPath/analysisWavPath を落とし mediaPath から再抽出+mediaHash 差し替え検知 (Task 11)
  - validateProjectFile 深化(sources[].edits/analysis・ui.fps/rounding の形チェック) (Task 11)
  - writeExports は `timeSigDenominatorFor(beatsPerBar)` で分母導出(ハードコード4禁止) (Task 10)
  - stereo-split は選択が実質ステレオ(いずれかのトラック≥2ch)の時のみ UI 提示 (Task 12)
  - 抽出フェーズ中インジケータ+「キャンセルは解析開始後に効く」挙動の明示 (Task 12)
  - undo がソース横断単一スタックである旨の UX 対応(非アクティブソースの undo 時はそのソースタブへ自動切替+トースト) (Task 12)
  - シーク時の発火済みメトロノームクリック osc の停止 / AudioContext.resume() 明示化 (Task 4)
  - ANALYZE_FAILED アクション+error フェーズ導入 (Task 1)
  - App.tsx の `sources.find(...)!` 非 null アサーション防御化 (Task 12)
  - MIDI 長ラベル(>127B)テスト追加 (Task 10)

## ファイル構成(新規/変更)

```
app/src/renderer/
  strings.ts                     # 全UI文言定数 (T1)
  App.tsx                        # 画面ルーティング(drop/analyzing/editor/error) (T1で骨格, T12で完成)
  state/store.ts                 # ANALYZE_FAILED/errorフェーズ, 選択マーカー, EDIT系追加分 (T1)
  state/viewStore.ts             # エディタ表示状態(zoom/scroll/snap/timeUnit/laneVisibility/loop) — undo対象外 (T3)
  editor/peaks.ts                # ピークmipmap純ロジック (T2)
  editor/peaks.worker.ts         # Workerエントリ (T2)
  editor/timeFormat.ts           # 秒/フレーム/TC/小節.拍 の format/parse (T3)
  editor/snap.ts                 # スナップ+nudge純ロジック (T3)
  editor/waveGeom.ts             # 波形座標変換(sec↔px)・ヒットテスト純ロジック (T5)
  audio/playback.ts              # (変更) seek時stale click停止・resume明示・onendedフック公開 (T4)
  components/Transport.tsx       # 再生/ループ/TC/メトロノーム/タップテンポ/手動マーカー (T4)
  components/GridBar.tsx         # BPM/オフセット/拍子/1拍目ずらし/アンカー/キー表示 (T8)
  components/NumericField.tsx    # クリックで直接入力できる数値/時刻フィールド (T8)
  components/Overview.tsx        # 全体波形+表示窓ドラッグ (T6)
  components/SectionBand.tsx     # セクション帯(境界ドラッグ/ダブルクリックリネーム) (T6)
  components/WaveCanvas.tsx      # メイン波形(グリッド/プレイヘッド/静寂ハッチ/アンカー旗/減光) (T5)
  components/HitLanes.tsx        # 帯域別ヒットレーン+感度スライダー (T7)
  components/MarkerTable.tsx     # マーカー一覧(フィルタ/ジャンプ/リネーム/削除/ソース横断) (T9)
  components/ExportPanel.tsx     # 書き出しパネル (T10)
  components/EditorScreen.tsx    # エディタ画面の組み立て+ソースタブ+ショートカット (T12)
  __tests__/…                    # 各タスクのテスト
app/src/main/
  ipcRegistry.ts                 # (変更) analyzeMediaのキャンセルセンチネル (T1)
  exportWriter.ts                # writeExports本実装(ExportContext組立→exporters→fs書込) (T10)
  projectStore.ts                # (変更) v1形式から wavパス除去・検証深化・migrate (T11)
  menu.ts                        # アプリメニュー(開く/保存/別名/最近使ったファイル) (T11)
  index.ts                       # (変更) menu配線・writeExports配線 (T10/T11)
app/src/shared/
  ipc.ts                         # (変更) AnalyzeResult sentinel型・ProjectFileState改訂・ExportRequest型 (T1/T10/T11)
app/package.json                 # devDeps: jsdom, @testing-library/react, @testing-library/user-event (T1)
app/vitest.config.ts             # renderer/components テストに jsdom 環境 (T1)
```

## インターフェース契約(全タスク共通の型 — A(T1-6, 実装検証済み)+ B(T7-12)を突き合わせた**確定版**)

> 実装者はこの節を正とすること。スケルトン初版から乖離した点は各行のコメントに理由を付す。
> 実コード上の既存型: `EditState` は `bpmOverride?: number`(undefined=クリア)・`beatsPerBar: number`・
> `gridAnchor?: {timeSec; freeBefore}`・`sectionEdits: SectionEdit[]`。丸めは `RoundingMode`(`"nearest"|"floor"`)。

```ts
// === T1: shared/ipc.ts ===
export type AnalyzeOutcome =
  | { cancelled: false; project: AnalyzedProject }
  | { cancelled: true };                       // ← IPC越えでも判別可能なセンチネル(ハンドラ境界で生成)
// IpcApi.analyzeMedia(): Promise<AnalyzeOutcome>(③aは AnalyzedProject 直返しだった)。
// MainDeps.analyzeMedia は Promise<AnalyzedProject> のまま。キャンセルは e.name==="AnalyzeCancelledError" で判定。

// === T1/T9/T11: renderer/state/store.ts(段階的に拡張) ===
// AppState.phase: "drop" | "input-config" | "analyzing" | "editor" | "error"
//   error フェーズは { phase:"error"; errorMessage:string }(★フィールド名は errorMessage)。
//   editor フェーズは { phase:"editor"; project; undo; redo; selectedMarkerId: string|null;
//                       isDirty: boolean; projectPath: string|null }  // selectedMarkerId=T1, isDirty/projectPath=T11
// Action 追加:
//   T1:  { type:"ANALYZE_FAILED"; message:string }  // → phase:"error"
//        { type:"MARKER_SELECTED"; markerId:string|null }  // テーブル↔キャンバス同期(undo対象外)。SOURCE_SWITCHED で null クリア
//   T9:  { type:"CUSTOM_MARKER_UPDATED"; id:string; patch: Partial<Pick<Marker,"label"|"timeSec">> }  // ラベル変更/nudge移動
//        { type:"MARKER_RESTORED"; id:string }  // deletedMarkerIds から除去(undo対象)
//   T11: { type:"SAVED"; path:string }  // isDirty=false, projectPath=path
//        { type:"PROJECT_LOADED"; state:ProjectFileState; path:string; playbackWavPath:string }  // ★ playbackWavPath は別引数
// ★網羅性ガード: reducer は「上段(フェーズ非依存の break 群)」と「editor 専用」の2つの switch を持ち、
//   両方に never 網羅チェックがある。Action 追加時は両方へ case を足す(T9/T11 は両方更新済み)。

// === T2: editor/peaks.ts ===
export interface PeakLevel { samplesPerBucket: number; min: Float32Array; max: Float32Array; }
export interface PeakSet { durationSec: number; sampleRate: number; length: number; levels: PeakLevel[]; }
export function buildPeakSet(channel: Float32Array, sampleRate: number,
  bucketSizes?: readonly number[] /* 既定 [256,1024,4096,16384] */): PeakSet;
export function pickLevel(peaks: PeakSet, samplesPerPx: number): PeakLevel; // 密度に最も近い(以下で最大)レベル
// worker(peaks.worker.ts): {type:"build", channel: Float32Array, sampleRate} → {type:"done", peaks}(min/max を transfer)。
// Worker 起動は EditorScreen(T12)が担当。WaveCanvas/Overview は peaks: PeakSet|null を prop で受ける。

// === T3: editor/timeFormat.ts / snap.ts / state/viewStore.ts ===
export type TimeUnit = "sec" | "frame" | "tc" | "barBeat";
export interface TimeCtx { fps: Fps; grid: GridBeat[]; }   // ★ Grid 型は無い。実体は deriveGrid() の GridBeat[]
export function formatTime(sec: number, unit: TimeUnit, ctx: TimeCtx): string;
export function parseTime(text: string, unit: TimeUnit, ctx: TimeCtx): number | null;  // 不正はnull
export type SnapMode = "beat" | "bar" | "frame" | "none";
export function snapSec(sec: number, mode: SnapMode, ctx: TimeCtx): number;            // 最近傍(空gridは恒等)
export function nudgeSec(sec: number, dir: 1|-1, fine: boolean): number;               // fine=true→±1ms(素の ,/.)、false→±10ms(Shift)
// viewStore: React context + useReducer。エクスポートは ViewStoreProvider / useViewStore()(=>{ view, dispatch })
//   / initialViewState / viewReducer(直接テスト用)。★ ViewProvider/useView/useViewDispatch は存在しない。
// ViewState: { zoomSamplesPerPx; scrollSec; snapMode; timeUnit;
//   laneVisibility: { beatGrid; sections; hits; silence }: boolean×4; loop: {a,b}|null; followPlayhead: boolean }
// ViewAction: SET_VIEW{scrollSec?,zoomSamplesPerPx?} | SET_SNAP | SET_TIME_UNIT | CYCLE_TIME_UNIT
//   | TOGGLE_LANE{lane} | SET_LOOP{loop} | SET_FOLLOW{on}

// === T4: audio/playback.ts(既存 PlaybackEngine API は不変) ===
export function createPlayback(ctxFactory?: () => AudioContext, opts?: { onEnded?: () => void }): PlaybackEngine;
//   seek/stop 時に予約済みメトロノームクリック osc を stop、play() 冒頭で ctx.state==="suspended" なら resume()、
//   自然終了で opts.onEnded を発火。updateGrid(beats: GridClick[])(GridClick={timeSec,isBar})。
// Transport props: { playback: PlaybackEngine; grid: GridBeat[]; fps: Fps; onAddMarker(sec); onTapTempo(bpm) }
//   表示単位/スナップ/ループは viewStore(useViewStore)から取得(prop ではない)。

// === T5: editor/waveGeom.ts(WaveLayout も本タスクで定義) ===
export interface Viewport { scrollSec: number; samplesPerPx: number; sampleRate: number; widthPx: number; }
export function secToPx(sec: number, vp: Viewport): number;
export function pxToSec(px: number, vp: Viewport): number;
export function visibleRange(vp: Viewport): { fromSec: number; toSec: number };
export function zoomAt(vp: Viewport, factor: number, anchorPx: number): Viewport;  // カーソル中心ズーム
export type WaveHit = { kind:"anchor" } | { kind:"sectionBoundary"; index:number }
  | { kind:"marker"; id:string } | { kind:"background" };
export function hitTest(px: number, py: number, layout: WaveLayout): WaveHit;
// 他: visibleGridLines / adaptiveBarStep / visibleMarkerTicks / silenceRegionsFromMarkers / freeZoneEndSec / paintWave。
// WaveCanvas props: { peaks; grid: GridBeat[]; markers: Marker[]; anchorSec: number|null;
//   playback: PlaybackEngine; sampleRate: number; onSelectMarker(id); onAnchorDrag(sec) }(scroll/zoom は viewStore を内部購読)。

// === T10: shared/ipc.ts 追加(書き出し) ===
export interface ExportRequest {
  targets: TargetKey[];                  // ★ naming.ts の TargetKey(11種)。ExportTarget 型は無い
  sourceIds: string[];                   // 書き出すソース(複数可)
  fps: Fps; rounding: RoundingMode;      // ★ RoundingMode(Rounding は誤記)
  include: MarkerType[];
  includeEnvelopes: boolean;             // ★ 追加: エンベロープは MarkerType でないため独立フラグ
  destDir: string;                       // 保存先(chooseExportDir で取得済み)
  projectState: ProjectFileState;        // 現在の編集状態一式(main はこれから ExportContext を組む)
}
export interface WriteExportsResult { written: string[]; failed: { path: string; message: string }[]; }  // ★ dir 無し
// IpcApi: writeExports(req: ExportRequest): Promise<WriteExportsResult>; chooseExportDir(): Promise<string|null>;
// main/exportWriter.ts: writeExports(req, deps: ExportWriterDeps): Promise<WriteExportsResult>
//   deps = { readFile; writeFile; extractWavForCues(mediaPath,destPath); tmpWavPath() }
//   ExportContext 組立は timeSigDenominatorFor(beatsPerBar) 必須(ハードコード4禁止)。
//   runExport("wavcues") は throw → wavcues は embedWavCues(wavBytes, markers, ctx) を直接呼ぶ。
//   エクスポータはエンベロープを内部で fps 再サンプルするので生の analysis.envelopes(100Hz)を渡す。
//   ファイル名衝突(naming.ts に dedup 無し)は exportWriter が -2/-3 付与で解消。
//   wavcues は .wav 入力なら原本コピー、動画入力は extractWavForCues で抽出した WAV に埋め込む(§8)。

// === T11: shared/ipc.ts ProjectFileState 改訂 + メニュー ===
// ProjectFileState から playbackWavPath を削除(スペック§6準拠)。version は 1 のまま
//   (③aの .bmk は本セッション内のみ・未配布 → migrate は「余剰キー無視」で足りる。validate は既知キーのみ検査)。
export type OpenProjectOutcome =
  | { ok: true; path: string; state: ProjectFileState; playbackWavPath: string; hashMismatch: boolean }  // ★ analyzed は無し(.bmk が analysis 保持)
  | { ok: false; message: string };
export type MenuEvent =
  | { action: "open" | "save" | "saveAs" | "undo" | "redo" }
  | { action: "openRecent"; path: string };
// IpcApi: openProject(): Promise<OpenProjectOutcome|null>; openProjectByPath(path): Promise<OpenProjectOutcome>;
// Bridge(renderer/preload): onMenu(cb: (ev: MenuEvent) => void): () => void;
// openProjectFlow(main): .bmk 読込 → mediaPath 存在確認 → ffmpeg 再抽出 → mediaHash 照合
//   (不一致は {hashMismatch:true} を返し renderer が続行/中止を確認)。
```

## タスク一覧(12タスク)

| # | タスク | 主対象 | リスク |
|---|---|---|---|
| 1 | 文言定数・errorフェーズ・キャンセルセンチネル・テスト基盤(jsdom/RTL) | strings/store/ipc/vitest | 中 |
| 2 | ピークmipmap+Worker | peaks | 中 |
| 3 | 時刻フォーマット/パース・スナップ/nudge・viewStore | timeFormat/snap | 中 |
| 4 | playback拡張+トランスポート | playback/Transport | 中 |
| 5 | メイン波形Canvas+座標系/ヒットテスト | waveGeom/WaveCanvas | 高 |
| 6 | オーバービュー+セクション帯 | Overview/SectionBand | 中 |
| 7 | ヒットレーン+感度スライダー | HitLanes | 低 |
| 8 | グリッド補正バー+数値直接入力 | GridBar/NumericField | 中 |
| 9 | マーカーテーブル+手動マーカー | MarkerTable | 低 |
| 10 | 書き出しパネル+writeExports本実装 | ExportPanel/exportWriter | 高 |
| 11 | .bmk改訂+メニュー統合+再オープン | projectStore/menu | 高 |
| 12 | エディタ統合+ショートカット+仕上げ | EditorScreen/App | 高 |

(各タスクの詳細ステップは以下に展開)

---

### Task 1: 文言定数・errorフェーズ・キャンセルセンチネル・テスト基盤(jsdom/RTL)

> **完了(2026-07-13, commit a715b07)**: レビュー verdict Yes・逸脱ゼロ・225/225。
> **後続タスクへの全体指示(T1レビューの Important 指摘)**: 本計画書の T2〜T12 のコード例は STRINGS を十分参照していない(例: T8 GridBar のローカル `S` テーブルは `可変` と書くが strings.ts は `可変テンポ`、`redo` キーは strings.ts に不存在、T12 に生の日本語リテラルあり)。**各タスクの実装者は、UI文言をコンポーネントローカルに定義せず strings.ts に寄せること(不足キーは strings.ts に追加し、計画コードのローカルテーブルは置き換える)**。これは承認済みの計画逸脱として扱う。
> **T9への追加指示**: selectedMarkerId が UNDO/REDO を素通りすることのピン留めテスト+選択中マーカー削除でIDがダングリングしても消費側は等値比較で無害である旨のコメントを追加。

**Files:**
- Create: `app/src/renderer/strings.ts`(全UI文言定数 — 計画③b全体が参照)
- Modify: `app/src/renderer/state/store.ts`(error フェーズ・ANALYZE_FAILED・MARKER_SELECTED・selectedMarkerId・網羅性ガード)
- Modify: `app/src/shared/ipc.ts`(`AnalyzeOutcome` センチネル型・`IpcApi.analyzeMedia` の戻り変更)
- Modify: `app/src/main/ipcRegistry.ts`(analyzeMedia ハンドラでキャンセル→`{cancelled:true}`)
- Modify: `app/src/main/analyzeMedia.ts`(`AnalyzeCancelledError` に `this.name` 設定)
- Modify: `app/src/renderer/App.tsx`(AnalyzeOutcome 分岐・error 画面ルーティング)
- Modify: `app/tsconfig.json`(`types:["node"]` → `types:[]`・`exclude` 追加)
- Modify: `app/vitest.config.ts`(`.tsx` テストを include)
- Modify: `app/package.json`(devDeps: jsdom / @testing-library/react / @testing-library/user-event)
- Test: `app/src/renderer/__tests__/store-error.test.ts`
- Test: `app/src/main/__tests__/ipcRegistry-cancel.test.ts`
- Test: `app/src/renderer/__tests__/components/smoke.test.tsx`

**Interfaces:**
- Consumes: 既存 `shared/ipc.ts`(AnalyzedProject)、`main/analyzeMedia.ts`(AnalyzeCancelledError)
- Produces(以降の全タスクが使う):
  - `STRINGS`(renderer/strings.ts): 画面別にネストした日本語文言オブジェクト
  - `AnalyzeOutcome`(shared/ipc.ts): `{cancelled:false; project} | {cancelled:true}`。`IpcApi.analyzeMedia(): Promise<AnalyzeOutcome>`
  - store: `phase:"error"` + `errorMessage`、`Action` に `ANALYZE_FAILED` / `MARKER_SELECTED`、editor state に `selectedMarkerId`
  - vitest: `src/renderer/__tests__/components/**` は先頭 docコメント `// @vitest-environment jsdom` で jsdom 実行(RTL パイプライン)

> **契約補正(実コード確認により)**: ①スケルトンは vitest の `environmentMatchGlobs` を指定していたが、インストール済み vitest **3.2.7** ではこれは deprecated(実行時に `"environmentMatchGlobs" is deprecated. Use test.projects instead` 警告を出す)。vitest はファイル先頭の `/@(?:vitest|jest)-environment\s+([\w-]+)/` を**最優先**で解釈するため、コンポーネントテストは per-file の `// @vitest-environment jsdom` docコメントで jsdom を選ぶ(警告ゼロ)。加えて `test.globals: true` を設定する — これが無いと @testing-library/react の自動 cleanup が afterEach に登録されず、複数 it をまたいで DOM が積み上がり "Found multiple elements" で落ちる(実証済み)。テストは全ファイル明示 import のままなので globals 化しても既存は不変。②`tsconfig.json` の `types` は「行削除」ではなく `[]` にする(削除すると `@types/node` が自動包含に戻り Node 型が復活してしまう)。同時に `exclude:["src/shared/__tests__"]` を足す(shared のテストは Node 組み込みを import しており、そちらは `tsconfig.node.json`=`types:["node"]` 側で型検査され二重にカバーされる)。③`AnalyzeOutcome` センチネルは `MainDeps.analyzeMedia`(=`Promise<AnalyzedProject>`, キャンセル時は throw)の戻りを **ipcRegistry のハンドラ境界で包んで**生成する(deps 自体の型は不変)。キャンセル判定は重い `analyzeMedia.ts` を import せず `e.name === "AnalyzeCancelledError"` で行う(ハンドオフの「`.name` 設定」方針・IPC 越えのエラー同一性依存を避ける)。④`selectedMarkerId` は AppState 全体ではなく **editor フェーズのオブジェクト**に持たせる(AppState は判別 union のため)。`SOURCE_SWITCHED` で null クリア。

- [ ] **Step 1: devDeps を追加し、テスト基盤の設定を変更**

```bash
cd /home/claude/beatmarks/app
npm install -D jsdom @testing-library/react @testing-library/user-event
```

Expected: 追加成功(この環境では `jsdom@29.1.1` / `@testing-library/react@16.3.2`(React19対応の16系)/ `@testing-library/user-event@14.6.1` が解決される)。

`app/vitest.config.ts` を次に置き換え(`.tsx` テストも収集):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // globals:true で @testing-library/react の自動 cleanup が afterEach に登録される
    // (これが無いと複数 it をまたいで DOM が積み上がり "Found multiple elements" で落ちる)。
    globals: true,
    // コンポーネントテスト(.tsx)は各ファイル先頭の `// @vitest-environment jsdom`
    // docコメントで jsdom を選択する(vitest 3 は環境コメントを最優先で解釈)。
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
  },
});
```

`app/tsconfig.json` を次に置き換え(renderer は Node 型を持たない):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src/renderer", "src/shared"],
  "exclude": ["src/shared/__tests__"]
}
```

- [ ] **Step 2: 文言定数ファイルを作成**

`app/src/renderer/strings.ts`(計画③b全画面の日本語文言。以降のタスクはここだけを参照する):

```ts
/** 全UI文言(スペック §7: 日本語MVP、将来英語化のため定数分離)。
 *  画面/機能ごとにネストし、コンポーネントは STRINGS.xxx を参照する。 */
export const STRINGS = {
  app: {
    name: "BeatMarks",
    extractedSuffix: "音声抽出済み",
    analyzeDone: "解析完了",
    engineStandard: "標準エンジン",
  },
  drop: {
    prompt: "音声・動画ファイルをここにドロップ",
    hint: "対応: mp4 / mov / wav / mp3 ほか(ffmpeg が扱える形式)",
    loadFailed: "ファイルの読み込みに失敗しました",
  },
  inputConfig: {
    title: "入力設定(複数トラック検出)",
    mixMode: "選択トラックを2mixに統合",
    multitrackMode: "マルチトラックとして読み込む(トラックごとに解析)",
    stereoSplit: "L/R を個別ソースとして解析",
    start: "解析開始",
  },
  analyzing: {
    title: "解析中…",
    preparing: "準備中",
    cancel: "キャンセル",
    cancelNote: "キャンセルは解析開始後に効きます(抽出フェーズ中は完了を待ちます)",
    extracting: "音声を抽出中…",
  },
  error: {
    title: "エラー",
    back: "戻る",
    extractFailed: "このファイルから音声を抽出できませんでした。対応形式か、破損・DRM保護がないかを確認してください。",
    analyzeFailed: "解析に失敗しました",
    unknown: "不明なエラーが発生しました",
  },
  transport: {
    prev: "⏮",
    play: "▶",
    pause: "⏸",
    loop: "🔁 ループ",
    setA: "A",
    setB: "B",
    confirmGroup: "確認",
    metronome: "🔔 メトロノーム",
    tapTempo: "タップテンポ",
    addGroup: "追加",
    addMarker: "◈ 手動マーカー",
    zoom: "ズーム",
    fpsDisplaySuffix: "fps 表示",
    secDisplaySuffix: "s表示",
    cycleUnitTitle: "クリックで表示単位を切替(秒 / フレーム / TC / 小節.拍)",
  },
  grid: {
    bpm: "BPM",
    fixed: "固定",
    variable: "可変テンポ",
    half: "½",
    double: "×2",
    offset: "グリッドオフセット",
    minus10: "−10ms",
    minus1: "−1ms",
    plus1: "+1ms",
    plus10: "+10ms",
    timeSig: "拍子",
    downbeatLeft: "1拍目 ←",
    downbeatRight: "→",
    downbeatTitle: "小節頭を1拍ずらす",
    key: "KEY",
    confidence: "信頼度",
    lowConfidence: "信頼度低",
    perSectionKeyPrefix: "セクション別: ",
    metronomeHint: "メトロノーム音を重ねて再生し、グリッドのズレを耳で確認 → オフセットで微調整",
  },
  overview: {
    hint: "曲全体。ドラッグで表示範囲を移動",
  },
  section: {
    barsSuffix: "小節",
    editHint: "境界ドラッグで移動 / ダブルクリックでリネーム / 右クリックで削除",
    addAtPlayhead: "＋境界(再生位置)",
    defaultLabel: "新規セクション",
    rename: "リネーム",
    delete: "削除",
  },
  hitLane: {
    tag: "ヒット検出レーン",
    low: "低域",
    mid: "中域",
    high: "高域",
    sensitivity: "感度",
    instantHint: "しきい値は再解析なしで即反映",
  },
  markerTable: {
    title: "マーカー一覧",
    countTemplate: (total: number, shown: number) => `全 ${total} 件(表示 ${shown} 件)`,
    filterSection: "セクション",
    filterBar: "小節",
    filterBeat: "拍",
    filterHit: "ヒット",
    filterCustom: "手動",
    colType: "種別",
    colLabel: "ラベル",
    colTimecode: "タイムコード",
    colFrame: "フレーム",
    colSeconds: "秒",
    colSource: "出所",
    srcAuto: "自動",
    srcUser: "手動",
    crossSource: "全ソース横断",
  },
  markerType: {
    beat: "拍",
    bar: "小節",
    section: "セクション",
    hit: "ヒット",
    silence: "静寂",
    custom: "手動",
  },
  timeUnit: {
    sec: "秒",
    frame: "フレーム",
    tc: "TC",
    barBeat: "小節.拍",
  },
  snap: {
    beat: "拍",
    bar: "小節",
    frame: "フレーム",
    none: "なし",
    label: "スナップ",
  },
  exportPanel: {
    title: "書き出し",
    fps: "フレームレート",
    rounding: "丸め",
    roundNearest: "最近傍",
    roundFloor: "切り捨て",
    includeLabel: "含めるマーカー:",
    incSection: "セクション",
    incBar: "小節",
    incBeat: "拍",
    incHit: "ヒット(低のみ)",
    incCustom: "手動",
    incEnvelope: "エンベロープ",
    targetsLabel: "書き出し先(複数可):",
    runTemplate: (n: number) => `⬇ 書き出し(${n}ファイル)`,
    aeNote: "AE: コンポマーカー+エンベロープをヌルに焼き込み",
    phase2Badge: "Phase2",
    doneTemplate: (n: number) => `${n} ファイルを書き出しました`,
    failedTemplate: (n: number) => `${n} ファイルの書き出しに失敗しました`,
    retry: "リトライ",
    changeDir: "場所を変更",
    noTarget: "書き出し先を1つ以上選んでください",
  },
  menu: {
    open: "開く…",
    save: "保存",
    saveAs: "別名で保存…",
    recent: "最近使ったファイル",
    hashMismatchTitle: "音声が変更されています",
    hashMismatch: "プロジェクト保存後に元の音声ファイルが変更された可能性があります。続行しますか?",
    continue: "続行",
    abort: "中止",
    mediaMissing: "元の音声ファイルが見つかりません",
  },
  shortcuts: {
    playPause: "再生/停止",
    marker: "マーカー追加",
    beatSeek: "拍単位シーク",
    undo: "取り消し",
    lanes: "レーン表示切替",
  },
} as const;

export type Strings = typeof STRINGS;
```

- [ ] **Step 3: 失敗するテストを書く(store の error フェーズ・選択)**

`app/src/renderer/__tests__/store-error.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { AnalyzedProject } from "../../shared/ipc.js";
import type { AnalysisResult } from "../../shared/types.js";
import { initialState, reducer } from "../state/store.js";

function analysis(): AnalysisResult {
  return {
    durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25,
    beats: Array.from({ length: 20 }, (_, i) => 0.25 + i * 0.5),
    downbeatPhase: 0, tempoMap: [{ timeSec: 0, bpm: 120 }],
    key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [{ startSec: 0, endSec: 10, label: "A", clusterId: 0, chorusCandidate: false }],
    hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: Array(1000).fill(0.5), low: [], mid: [], high: [] },
  };
}

function project(): AnalyzedProject {
  return {
    mediaPath: "/m/t.mp4", mediaHash: "h".repeat(64), baseName: "t",
    playbackWavPath: "/tmp/p.wav", durationSec: 10,
    sources: [
      { source: { id: "mix", kind: "mix", label: "2mix" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/a.wav" },
      { source: { id: "ch-L", kind: "channel", label: "L" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/l.wav" },
    ],
  };
}

const editor = () => reducer(initialState(), { type: "PROJECT_READY", project: project() });

describe("error フェーズ", () => {
  it("ANALYZE_FAILED で error フェーズ+メッセージ保持", () => {
    const s = reducer({ phase: "analyzing", progress: null }, { type: "ANALYZE_FAILED", message: "boom" });
    expect(s.phase).toBe("error");
    if (s.phase === "error") expect(s.errorMessage).toBe("boom");
  });

  it("error フェーズから RESET で drop に戻る", () => {
    const s = reducer({ phase: "error", errorMessage: "x" }, { type: "RESET" });
    expect(s.phase).toBe("drop");
  });

  it("editor 到達前(drop)でも ANALYZE_FAILED は error に遷移できる", () => {
    const s = reducer(initialState(), { type: "ANALYZE_FAILED", message: "y" });
    expect(s.phase).toBe("error");
  });
});

describe("マーカー選択(undo対象外)", () => {
  it("PROJECT_READY 直後は selectedMarkerId が null", () => {
    const s = editor();
    if (s.phase !== "editor") throw new Error();
    expect(s.selectedMarkerId).toBeNull();
  });

  it("MARKER_SELECTED で selectedMarkerId を設定/クリアできる", () => {
    let s = reducer(editor(), { type: "MARKER_SELECTED", markerId: "bar-2" });
    if (s.phase !== "editor") throw new Error();
    expect(s.selectedMarkerId).toBe("bar-2");
    s = reducer(s, { type: "MARKER_SELECTED", markerId: null });
    if (s.phase !== "editor") throw new Error();
    expect(s.selectedMarkerId).toBeNull();
  });

  it("MARKER_SELECTED は undo スタックを積まない", () => {
    const s = reducer(editor(), { type: "MARKER_SELECTED", markerId: "bar-2" });
    if (s.phase !== "editor") throw new Error();
    expect(s.undo).toHaveLength(0);
  });

  it("SOURCE_SWITCHED で選択がクリアされる", () => {
    let s = reducer(editor(), { type: "MARKER_SELECTED", markerId: "bar-2" });
    s = reducer(s, { type: "SOURCE_SWITCHED", sourceId: "ch-L" });
    if (s.phase !== "editor") throw new Error();
    expect(s.project.activeSourceId).toBe("ch-L");
    expect(s.selectedMarkerId).toBeNull();
  });
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `npx vitest run src/renderer/__tests__/store-error.test.ts`
Expected: FAIL(`ANALYZE_FAILED` / `MARKER_SELECTED` が Action に無く型・実行時とも不一致)

- [ ] **Step 5: store.ts を実装(error フェーズ・選択・網羅性ガード)**

`app/src/renderer/state/store.ts` を以下のとおり変更する。

(1) `AppState` union を次に置き換え(error 追加・editor に `selectedMarkerId`):

```ts
export type AppState =
  | { phase: "drop" }
  | { phase: "input-config"; filePath: string; probe: import("../../shared/ipc.js").ProbeResult }
  | { phase: "analyzing"; progress: AnalyzeProgressEvent | null }
  | { phase: "error"; errorMessage: string }
  | {
      phase: "editor";
      project: EditorProject;
      undo: UndoEntry[];
      redo: UndoEntry[];
      selectedMarkerId: string | null;
    };
```

(2) `Action` union に2つ追加(既存の末尾 `| { type: "REDO" };` の直前に挿入):

```ts
  | { type: "ANALYZE_FAILED"; message: string }
  | { type: "MARKER_SELECTED"; markerId: string | null }
```

(3) 上段 switch(フェーズ非依存)の `case "RESET":` の直後に `ANALYZE_FAILED` を追加:

```ts
    case "RESET":
      return initialState();
    case "ANALYZE_FAILED":
      return { phase: "error", errorMessage: action.message };
```

(4) 同じ上段 switch のフォールスルー群(`case "SOURCE_SWITCHED":` などが並ぶ `break` グループ)に `MARKER_SELECTED` を追加:

```ts
    case "EDIT_APPLIED":
    case "SECTION_EDIT_ADDED":
    case "CUSTOM_MARKER_ADDED":
    case "MARKER_DELETED":
    case "MARKER_SELECTED":
    case "SOURCE_SWITCHED":
    case "FPS_CHANGED":
    case "ROUNDING_CHANGED":
    case "UNDO":
    case "REDO":
      break;
```

(5) `PROJECT_READY` と `PROJECT_LOADED` が返す editor state に `selectedMarkerId: null` を追加(両ケースの `undo: [], redo: [],` の行に続けて):

```ts
        undo: [], redo: [], selectedMarkerId: null,
```

(6) 下段 switch(editor 専用)の `case "SOURCE_SWITCHED":` を選択クリア込みに置き換え、`MARKER_SELECTED` を追加:

```ts
    case "SOURCE_SWITCHED":
      return {
        ...state,
        project: { ...state.project, activeSourceId: action.sourceId },
        selectedMarkerId: null,
      };
    case "MARKER_SELECTED":
      return { ...state, selectedMarkerId: action.markerId };
```

> 網羅性: `ANALYZE_FAILED` は上段で return、`MARKER_SELECTED` は上段で `break`→下段で処理。これで上段 default(`never`)・下段 default(`never`)とも到達不能を維持する(型エラーが出れば追加漏れ)。`withActiveEdits` / `UNDO` / `REDO` は `...state` 展開で `selectedMarkerId` を素通しするため変更不要。

- [ ] **Step 6: store テストが通ることを確認**

Run: `npx vitest run src/renderer/__tests__/store-error.test.ts src/renderer/__tests__/store.test.ts`
Expected: store-error 7 tests + 既存 store 9 tests すべて passed

- [ ] **Step 7: 失敗するテストを書く(センチネル変換 through registerHandlers)**

`app/src/main/__tests__/ipcRegistry-cancel.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS, type AnalyzedProject, type AnalyzeOutcome } from "../../shared/ipc.js";
import { registerHandlers, type MainDeps } from "../ipcRegistry.js";

function fakeIpcMain() {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  return {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn),
    invoke: async (ch: string, ...args: unknown[]) => {
      const fn = handlers.get(ch);
      if (!fn) throw new Error(`no handler: ${ch}`);
      return fn({}, ...args);
    },
  };
}

const PROJECT = { baseName: "t" } as unknown as AnalyzedProject;

function deps(over: Partial<MainDeps> = {}): MainDeps {
  return {
    probeMedia: vi.fn(async () => ({ durationSec: 3, tracks: [] })),
    analyzeMedia: vi.fn(async () => PROJECT),
    cancelAnalyze: vi.fn(async () => {}),
    readFileBytes: vi.fn(async () => new Uint8Array([1]).buffer),
    saveProject: vi.fn(async () => "/tmp/x.bmk"),
    openProject: vi.fn(async () => null),
    writeExports: vi.fn(async () => ({ dir: null, written: [], failed: [] })),
    ...over,
  };
}

const REQ = { filePath: "/a.wav", input: { mode: "mix", trackIndexes: [0], channelSplit: "mono" } } as const;

describe("analyzeMedia センチネル変換", () => {
  it("成功時は {cancelled:false, project}", async () => {
    const ipc = fakeIpcMain();
    registerHandlers(ipc as never, deps());
    const out = (await ipc.invoke(IPC_CHANNELS.analyzeMedia, REQ)) as AnalyzeOutcome;
    expect(out.cancelled).toBe(false);
    if (!out.cancelled) expect(out.project.baseName).toBe("t");
  });

  it("AnalyzeCancelledError(name一致)は {cancelled:true} に変換される", async () => {
    const ipc = fakeIpcMain();
    const err = Object.assign(new Error("解析がキャンセルされました"), { name: "AnalyzeCancelledError" });
    registerHandlers(ipc as never, deps({ analyzeMedia: vi.fn(async () => { throw err; }) }));
    const out = (await ipc.invoke(IPC_CHANNELS.analyzeMedia, REQ)) as AnalyzeOutcome;
    expect(out).toEqual({ cancelled: true });
  });

  it("その他のエラーはそのまま再送出される", async () => {
    const ipc = fakeIpcMain();
    registerHandlers(ipc as never, deps({ analyzeMedia: vi.fn(async () => { throw new Error("boom"); }) }));
    await expect(ipc.invoke(IPC_CHANNELS.analyzeMedia, REQ)).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 8: テストが失敗することを確認**

Run: `npx vitest run src/main/__tests__/ipcRegistry-cancel.test.ts`
Expected: FAIL(`AnalyzeOutcome` 型が未定義・ハンドラが素の project を返す)

- [ ] **Step 9: shared/ipc.ts・ipcRegistry.ts・analyzeMedia.ts を実装**

`app/src/shared/ipc.ts`: `AnalyzedProject` の定義直後に `AnalyzeOutcome` を追加し、`IpcApi.analyzeMedia` の戻りを変更する。

```ts
/** analyzeMedia の戻り。キャンセルは IPC 越えでも判別できるセンチネルにする
 *  (renderer 側でエラー同一性/メッセージ照合をしないための境界変換)。 */
export type AnalyzeOutcome =
  | { cancelled: false; project: AnalyzedProject }
  | { cancelled: true };
```

`IpcApi` 内の該当行を置き換え:

```ts
  analyzeMedia(req: AnalyzeRequest): Promise<AnalyzeOutcome>;
```

`app/src/main/ipcRegistry.ts`: import に `AnalyzeOutcome` を足し、analyzeMedia の `handle` を包む実装に置き換える(他の handle は不変)。

```ts
import { IPC_CHANNELS, type AnalyzedProject, type AnalyzeOutcome, type AnalyzeRequest, type ExportFilePayload, type ProbeResult, type ProjectFileState, type WriteExportsResult } from "../shared/ipc.js";
```

`registerHandlers` 内の `analyzeMedia` 登録行を置き換え:

```ts
  ipcMain.handle(
    IPC_CHANNELS.analyzeMedia,
    async (_e, req: AnalyzeRequest): Promise<AnalyzeOutcome> => {
      try {
        const project = await deps.analyzeMedia(req);
        return { cancelled: false, project };
      } catch (e) {
        // キャンセルは name で判定する(IPC 越えのエラー同一性に依存しない/
        // analyzeMedia.ts の重い import を避ける — AnalyzeCancelledError.name は Task1 で設定)。
        if (e instanceof Error && e.name === "AnalyzeCancelledError") {
          return { cancelled: true };
        }
        throw e;
      }
    },
  );
```

> `MainDeps.analyzeMedia` の型(`Promise<AnalyzedProject>`)は不変。

`app/src/main/analyzeMedia.ts`: `AnalyzeCancelledError` を name 付きに置き換える。

```ts
export class AnalyzeCancelledError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "AnalyzeCancelledError";
  }
}
```

- [ ] **Step 10: App.tsx を AnalyzeOutcome 分岐 + error 画面に対応**

`app/src/renderer/App.tsx`: `startAnalyze` を置き換え(cancelled は無音で drop へ、error のみ ANALYZE_FAILED)。

```tsx
  async function startAnalyze(filePath: string, input: InputConfig): Promise<void> {
    dispatch({ type: "ANALYZE_STARTED" });
    try {
      const outcome = await getIpc().analyzeMedia({ filePath, input });
      if (outcome.cancelled) {
        dispatch({ type: "RESET" }); // キャンセルは静かにドロップ画面へ
        return;
      }
      dispatch({ type: "PROJECT_READY", project: outcome.project });
    } catch (err) {
      dispatch({ type: "ANALYZE_FAILED", message: `${STRINGS.error.analyzeFailed}: ${String(err)}` });
    }
  }
```

同ファイル冒頭の import に strings を追加:

```tsx
import { STRINGS } from "./strings.js";
```

`analyzing` 画面ブロックの直後(`// editor(...)` コメントの直前)に error 画面ブロックを挿入:

```tsx
  if (state.phase === "error") {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        <div style={{ ...box, width: 460, textAlign: "center" }}>
          <div style={{ fontWeight: 700, color: "#ff6b6b" }}>{STRINGS.error.title}</div>
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85, lineHeight: 1.6 }}>
            {state.errorMessage}
          </div>
          <button style={{ marginTop: 16 }} onClick={() => dispatch({ type: "RESET" })}>
            {STRINGS.error.back}
          </button>
        </div>
      </div>
    );
  }
```

- [ ] **Step 11: 失敗するテストを書く(RTL/jsdom スモーク)**

`app/src/renderer/__tests__/components/smoke.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import React from "react";

function Probe(props: { label: string }): React.JSX.Element {
  return <div role="status">{props.label}</div>;
}

describe("jsdom + RTL パイプライン", () => {
  it("コンポーネントを描画してテキストを取得できる", () => {
    render(<Probe label="ok" />);
    expect(screen.getByRole("status").textContent).toBe("ok");
  });
});
```

- [ ] **Step 12: 全テスト + typecheck + ビルドで検証**

Run:

```bash
npx vitest run 2>&1 | tail -4
npx tsc --noEmit && npx tsc -p tsconfig.node.json --noEmit && echo "typecheck OK"
npx electron-vite build 2>&1 | tail -3 || echo "build skip(この環境はelectronバイナリ取得不可の場合あり — ③cのCIで担保)"
```

Expected: 全 **225 passed**(既存214 + store-error 7 + ipcRegistry-cancel 3 + smoke 1 = 214+11)、typecheck OK。
(注: smoke.test.tsx は jsdom、それ以外は node 環境で走る。混在は per-file 環境コメントで解決している)

- [ ] **Step 13: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/renderer/strings.ts app/src/renderer/state/store.ts app/src/shared/ipc.ts \
  app/src/main/ipcRegistry.ts app/src/main/analyzeMedia.ts app/src/renderer/App.tsx \
  app/tsconfig.json app/vitest.config.ts app/package.json app/package-lock.json \
  app/src/renderer/__tests__/store-error.test.ts app/src/main/__tests__/ipcRegistry-cancel.test.ts \
  app/src/renderer/__tests__/components/smoke.test.tsx
git commit -m "feat(app): 文言定数・errorフェーズ/選択・キャンセルセンチネル・jsdom/RTL基盤

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SR5fj8BNeN6TUFgoj4zhm6"
```

---

### Task 2: ピークmipmap+Worker

> **完了(2026-07-13, commit 5a8f2b1)**: レビュー verdict Yes・逸脱ゼロ・233/233。軽微メモ: pickLevel は levels 空で undefined を返しうる(現到達不能・将来公開時にガード) / buildLevel はレベル毎に生データ全走査 O(4n)(1hで~317M比較、Worker内なので許容。粗レベルを細レベルから導出する最適化は将来課題)。

**Files:**
- Create: `app/src/renderer/editor/peaks.ts`
- Create: `app/src/renderer/editor/peaks.worker.ts`
- Test: `app/src/renderer/__tests__/peaks.test.ts`

**Interfaces:**
- Consumes: なし(純ロジック + Web Worker シェル)
- Produces(契約どおり):
  - `PeakLevel { samplesPerBucket; min: Float32Array; max: Float32Array }`
  - `PeakSet { durationSec; sampleRate; length; levels: PeakLevel[] }`
  - `buildPeakSet(channel, sampleRate, bucketSizes?=[256,1024,4096,16384]): PeakSet` — バケットごと min/max、最後の端数バケットも1バケットとして処理
  - `pickLevel(peaks, samplesPerPx): PeakLevel` — `samplesPerBucket ≤ samplesPerPx` の最大、無ければ最小
  - worker: `{type:"build", channel: Float32Array, sampleRate}` → `{type:"done", peaks}`(min/max の ArrayBuffer を transfer)

> worker ファイル(`peaks.worker.ts`)は `buildPeakSet` を呼ぶだけの薄いシェル。ロジック検証は `buildPeakSet`/`pickLevel` を**直接**呼ぶテストで担保する(worker 起動は jsdom で不安定・electron-vite のバンドルが要るため T12 の実機/③c E2E で確認)。WaveCanvas(T5)は `peaks: PeakSet | null` を prop で受け取り、worker 起動は EditorScreen(T12)が行う。

- [ ] **Step 1: 失敗するテストを書く**

`app/src/renderer/__tests__/peaks.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildPeakSet, pickLevel } from "../editor/peaks.js";

describe("buildPeakSet", () => {
  it("既知ランプ配列: バケットごとに min/max が正確", () => {
    // 0..7 のランプ、bucketSize=4 → [0..3]→min0/max3, [4..7]→min4/max7
    const ch = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const ps = buildPeakSet(ch, 8, [4]);
    expect(ps.length).toBe(8);
    expect(ps.durationSec).toBeCloseTo(1, 9);
    expect(ps.levels).toHaveLength(1);
    const lv = ps.levels[0]!;
    expect(lv.samplesPerBucket).toBe(4);
    expect(Array.from(lv.min)).toEqual([0, 4]);
    expect(Array.from(lv.max)).toEqual([3, 7]);
    expect(lv.min).toBeInstanceOf(Float32Array);
  });

  it("正弦波: バケット内の min/max が符号込みで取れる", () => {
    const N = 1024;
    const ch = new Float32Array(N);
    for (let i = 0; i < N; i++) ch[i] = Math.sin((2 * Math.PI * i) / N);
    const ps = buildPeakSet(ch, N, [N]); // 全体で1バケット
    expect(ps.levels[0]!.min[0]!).toBeCloseTo(-1, 2);
    expect(ps.levels[0]!.max[0]!).toBeCloseTo(1, 2);
  });

  it("端数バケット: 長さがbucketSizeの倍数でなくても最後の端数を1バケットにする", () => {
    const ch = Float32Array.from([0, 5, -2, 9, 1]); // 5サンプル, bucket=2 → 3バケット([0,5],[-2,9],[1])
    const ps = buildPeakSet(ch, 5, [2]);
    const lv = ps.levels[0]!;
    expect(lv.min).toHaveLength(3);
    expect(Array.from(lv.min)).toEqual([0, -2, 1]);
    expect(Array.from(lv.max)).toEqual([5, 9, 1]);
  });

  it("既定 bucketSizes は [256,1024,4096,16384] の4レベル", () => {
    const ps = buildPeakSet(new Float32Array(20000), 44100);
    expect(ps.levels.map((l) => l.samplesPerBucket)).toEqual([256, 1024, 4096, 16384]);
  });

  it("空配列でも壊れない(各レベル0バケット)", () => {
    const ps = buildPeakSet(new Float32Array(0), 44100, [256]);
    expect(ps.length).toBe(0);
    expect(ps.levels[0]!.min).toHaveLength(0);
  });
});

describe("pickLevel", () => {
  const ps = buildPeakSet(new Float32Array(100000), 44100); // [256,1024,4096,16384]

  it("samplesPerPx 以下で最大の samplesPerBucket を選ぶ", () => {
    expect(pickLevel(ps, 5000).samplesPerBucket).toBe(4096);
    expect(pickLevel(ps, 4096).samplesPerBucket).toBe(4096); // 境界は「以下」で採用
    expect(pickLevel(ps, 4095).samplesPerBucket).toBe(1024);
  });

  it("どれも大きすぎる(密に拡大)ときは最小レベル", () => {
    expect(pickLevel(ps, 10).samplesPerBucket).toBe(256);
    expect(pickLevel(ps, 255).samplesPerBucket).toBe(256);
  });

  it("十分に縮小したら最大レベル", () => {
    expect(pickLevel(ps, 1e9).samplesPerBucket).toBe(16384);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/renderer/__tests__/peaks.test.ts`
Expected: FAIL — `Cannot find module '../editor/peaks.js'`

- [ ] **Step 3: 実装**

`app/src/renderer/editor/peaks.ts`:

```ts
/** 波形ピークの mipmap(ズームレベル別の min/max)。Worker でプリ計算し Canvas 描画で使う。
 *  各レベルは samplesPerBucket ごとに [min,max] を Float32Array で持つ(スペック §7)。 */

export interface PeakLevel {
  samplesPerBucket: number;
  min: Float32Array;
  max: Float32Array;
}

export interface PeakSet {
  durationSec: number;
  sampleRate: number;
  length: number;
  levels: PeakLevel[];
}

export const DEFAULT_BUCKET_SIZES = [256, 1024, 4096, 16384] as const;

function buildLevel(channel: Float32Array, samplesPerBucket: number): PeakLevel {
  const n = channel.length;
  const bucketCount = Math.ceil(n / samplesPerBucket);
  const min = new Float32Array(bucketCount);
  const max = new Float32Array(bucketCount);
  for (let b = 0; b < bucketCount; b++) {
    const start = b * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, n); // 最後の端数バケットは end<start+bucket
    let lo = channel[start]!;
    let hi = lo;
    for (let i = start + 1; i < end; i++) {
      const v = channel[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { samplesPerBucket, min, max };
}

export function buildPeakSet(
  channel: Float32Array,
  sampleRate: number,
  bucketSizes: readonly number[] = DEFAULT_BUCKET_SIZES,
): PeakSet {
  return {
    durationSec: sampleRate > 0 ? channel.length / sampleRate : 0,
    sampleRate,
    length: channel.length,
    levels: bucketSizes.map((s) => buildLevel(channel, s)),
  };
}

/** 表示密度 samplesPerPx に最も近いレベル: samplesPerBucket ≤ samplesPerPx の最大、
 *  無ければ(密に拡大しすぎ)最小レベルを返す。 */
export function pickLevel(peaks: PeakSet, samplesPerPx: number): PeakLevel {
  let eligible: PeakLevel | null = null;
  let smallest = peaks.levels[0]!;
  for (const lv of peaks.levels) {
    if (lv.samplesPerBucket < smallest.samplesPerBucket) smallest = lv;
    if (lv.samplesPerBucket <= samplesPerPx) {
      if (!eligible || lv.samplesPerBucket > eligible.samplesPerBucket) eligible = lv;
    }
  }
  return eligible ?? smallest;
}
```

`app/src/renderer/editor/peaks.worker.ts`(薄いシェル — ロジックは peaks.ts):

```ts
/** ピーク計算 Worker(electron-vite の `new Worker(new URL(...), {type:"module"})` で起動)。
 *  受信 {type:"build", channel, sampleRate} → 送信 {type:"done", peaks}(min/max を transfer)。 */
import { buildPeakSet } from "./peaks.js";

interface BuildMsg { type: "build"; channel: Float32Array; sampleRate: number }

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<BuildMsg>) => void) | null;
  postMessage: (msg: unknown, transfer: Transferable[]) => void;
};

ctx.onmessage = (e) => {
  if (e.data.type !== "build") return;
  const peaks = buildPeakSet(e.data.channel, e.data.sampleRate);
  const transfer: Transferable[] = [];
  for (const lv of peaks.levels) transfer.push(lv.min.buffer, lv.max.buffer);
  ctx.postMessage({ type: "done", peaks }, transfer);
};
```

> T12 での起動例(参考・実装は T12):
> ```ts
> const w = new Worker(new URL("../editor/peaks.worker.ts", import.meta.url), { type: "module" });
> w.onmessage = (e) => setPeaks((e.data as { peaks: PeakSet }).peaks);
> w.postMessage({ type: "build", channel, sampleRate }, [channel.buffer]);
> ```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/renderer/__tests__/peaks.test.ts && npx tsc --noEmit`
Expected: 8 passed、typecheck OK

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/renderer/editor/peaks.ts app/src/renderer/editor/peaks.worker.ts app/src/renderer/__tests__/peaks.test.ts
git commit -m "feat(app): 波形ピークmipmap(buildPeakSet/pickLevel)+計算Worker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SR5fj8BNeN6TUFgoj4zhm6"
```

---

### Task 3: 時刻フォーマット/パース・スナップ/nudge・viewStore

> **完了(2026-07-13, commit 4a46ed0)**: レビュー verdict Yes・逸脱ゼロ・255/255。ファズ検証: 往復ドリフト sec≤0.5ms / tc≤半フレーム(理論限界) / barBeat 7240拍で誤り0(6/8・負小節含む)。Minor持ち越し(最終レビューで再考): parseTime の桁あふれ("99:99"→6039s を許容) / formatTime の NaN/Infinity 無ガード / snapSec nearest の NaN が grid[0] に化ける / nudge の IEEE754 ダストは表示層が吸収(機能影響なし)。

**Files:**
- Create: `app/src/renderer/editor/timeFormat.ts`
- Create: `app/src/renderer/editor/snap.ts`
- Create: `app/src/renderer/state/viewStore.ts`
- Test: `app/src/renderer/__tests__/timeFormat.test.ts`
- Test: `app/src/renderer/__tests__/snap.test.ts`
- Test: `app/src/renderer/__tests__/viewStore.test.ts`

**Interfaces:**
- Consumes: `shared/timebase.ts`(`timeToFrame`/`frameToTime`/`formatTimecode`/`fpsValue`)、`shared/deriveGrid.ts`(`GridBeat`/`barsOf`)、`shared/types.ts`(`Fps`)
- Produces(契約どおり):
  - `TimeUnit = "sec"|"frame"|"tc"|"barBeat"`、`TimeCtx { fps: Fps; grid: GridBeat[] }`
  - `formatTime(sec, unit, ctx): string` / `parseTime(text, unit, ctx): number | null`
  - `SnapMode = "beat"|"bar"|"frame"|"none"`、`snapSec(sec, mode, ctx): number`、`nudgeSec(sec, dir, fine): number`
  - `viewStore`: React context + `useReducer`。`initialViewState` / `viewReducer`(直接テスト用)+ `ViewStoreProvider` / `useViewStore`

> **契約補正**: 契約の `TimeCtx { fps: Fps; grid: Grid }` の `Grid` は shared に実型が無い。実体は `deriveGrid()` の戻り `GridBeat[]` なので `TimeCtx = { fps: Fps; grid: GridBeat[] }` とする。`timebase` の実関数名は `timeToFrame` / `frameToTime`(契約メモの「secondsToFrame/frameToSeconds」は存在しない)。`nudgeSec(sec, dir, fine)` の `fine`: `true`=±1ms(素の `,`/`.`)、`false`=±10ms(Shift 併用)。呼び出し側は `fine = !e.shiftKey` を渡す(スペック §7「±1ms、Shift で ±10ms」)。

- [ ] **Step 1: 失敗するテストを書く(timeFormat)**

`app/src/renderer/__tests__/timeFormat.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { deriveGrid } from "../../shared/deriveGrid.js";
import { FPS_PRESETS } from "../../shared/timebase.js";
import type { AnalysisResult } from "../../shared/types.js";
import { formatTime, parseTime, type TimeCtx } from "../editor/timeFormat.js";
import { defaultEditState } from "../../shared/validate.js";

const FPS30 = FPS_PRESETS["30"]!;
const FPS2997 = FPS_PRESETS["29.97"]!;

function grid() {
  // BPM120, offset0 → 拍0.5s間隔、4/4。小節1=拍0(0s)、拍0.5=小節1拍2 …
  const a: AnalysisResult = {
    durationSec: 20, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0,
    beats: Array.from({ length: 40 }, (_, i) => i * 0.5), downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [], hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
  };
  return deriveGrid(a, defaultEditState());
}

const ctx30: TimeCtx = { fps: FPS30, grid: grid() };
const ctx2997: TimeCtx = { fps: FPS2997, grid: grid() };

describe("sec 単位", () => {
  it("M:SS.mmm 形式", () => {
    expect(formatTime(83.456, "sec", ctx30)).toBe("1:23.456");
    expect(formatTime(0, "sec", ctx30)).toBe("0:00.000");
    expect(formatTime(9.5, "sec", ctx30)).toBe("0:09.500");
  });
  it("parse は 'M:SS.mmm' も 'SS.mmm' も許容", () => {
    expect(parseTime("1:23.456", "sec", ctx30)).toBeCloseTo(83.456, 6);
    expect(parseTime("83.456", "sec", ctx30)).toBeCloseTo(83.456, 6);
    expect(parseTime("bad", "sec", ctx30)).toBeNull();
  });
});

describe("frame 単位", () => {
  it("整数フレーム(round)", () => {
    expect(formatTime(1, "frame", ctx30)).toBe("30");
    expect(formatTime(1.017, "frame", ctx30)).toBe("31"); // 30.51→round31
  });
  it("parse→frameToTime 往復", () => {
    expect(parseTime("30", "frame", ctx30)).toBeCloseTo(1, 6);
    expect(parseTime("x", "frame", ctx30)).toBeNull();
  });
});

describe("tc 単位", () => {
  it("30fps 往復", () => {
    const tc = formatTime(60, "tc", ctx30);
    expect(tc).toBe("00:01:00:00");
    expect(parseTime(tc, "tc", ctx30)).toBeCloseTo(60, 6);
  });
  it("29.97 ノンドロップ: format→parse がフレーム量子化値に一致", () => {
    const sec = 61.234;
    const tc = formatTime(sec, "tc", ctx2997);
    const back = parseTime(tc, "tc", ctx2997)!;
    // フレームに丸めた値と往復一致(±半フレーム内)
    expect(Math.abs(back - sec)).toBeLessThan(1001 / 30000);
    expect(parseTime(tc, "tc", ctx2997)).not.toBeNull();
  });
  it("不正TCはnull", () => {
    expect(parseTime("1:2:3", "tc", ctx30)).toBeNull();
  });
});

describe("barBeat 単位", () => {
  it("小節.拍 表示(0s=小節1拍1, 0.5s=小節1拍2, 2s=小節2拍1)", () => {
    expect(formatTime(0, "barBeat", ctx30)).toBe("1.1");
    expect(formatTime(0.5, "barBeat", ctx30)).toBe("1.2");
    expect(formatTime(2, "barBeat", ctx30)).toBe("2.1");
  });
  it("parse: '2.1' → 小節2拍1 の秒", () => {
    expect(parseTime("2.1", "barBeat", ctx30)).toBeCloseTo(2, 6);
    expect(parseTime("1.3", "barBeat", ctx30)).toBeCloseTo(1, 6);
  });
  it("範囲外の拍/小節は null", () => {
    expect(parseTime("99.1", "barBeat", ctx30)).toBeNull();
    expect(parseTime("1.9", "barBeat", ctx30)).toBeNull(); // 4/4 に拍9は無い
  });
  it("グリッド空なら format は '–'", () => {
    expect(formatTime(1, "barBeat", { fps: FPS30, grid: [] })).toBe("–");
  });
});
```

- [ ] **Step 2: テスト失敗を確認 → timeFormat.ts 実装**

Run: `npx vitest run src/renderer/__tests__/timeFormat.test.ts`
Expected: FAIL — `Cannot find module '../editor/timeFormat.js'`

`app/src/renderer/editor/timeFormat.ts`:

```ts
/** 時刻の表示/入力変換(スペック §7)。単位: 秒(ms精度)/ フレーム / タイムコード / 小節.拍。 */
import type { GridBeat } from "../../shared/deriveGrid.js";
import { formatTimecode, frameToTime, timeToFrame } from "../../shared/timebase.js";
import type { Fps } from "../../shared/types.js";

export type TimeUnit = "sec" | "frame" | "tc" | "barBeat";
export interface TimeCtx {
  fps: Fps;
  grid: GridBeat[];
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, "0");
}

function nearestBeat(grid: GridBeat[], sec: number): GridBeat | null {
  if (grid.length === 0) return null;
  let best = grid[0]!;
  let bestD = Math.abs(best.timeSec - sec);
  for (const g of grid) {
    const d = Math.abs(g.timeSec - sec);
    if (d < bestD) { best = g; bestD = d; }
  }
  return best;
}

function barBeatOf(grid: GridBeat[], g: GridBeat): { bar: number; beat: number } {
  // g と同じ小節の小節頭(isBar, 同 barNumber, index ≤ g.index)を探し拍番号を数える
  let barStart = g;
  for (const b of grid) {
    if (b.isBar && b.barNumber === g.barNumber && b.index <= g.index) barStart = b;
  }
  return { bar: g.barNumber, beat: g.index - barStart.index + 1 };
}

export function formatTime(sec: number, unit: TimeUnit, ctx: TimeCtx): string {
  switch (unit) {
    case "sec": {
      const ms = Math.round(Math.max(0, sec) * 1000);
      return `${Math.floor(ms / 60000)}:${pad(Math.floor((ms % 60000) / 1000), 2)}.${pad(ms % 1000, 3)}`;
    }
    case "frame":
      return String(timeToFrame(sec, ctx.fps, "nearest"));
    case "tc":
      return formatTimecode(timeToFrame(sec, ctx.fps, "nearest"), ctx.fps);
    case "barBeat": {
      const g = nearestBeat(ctx.grid, sec);
      if (!g) return "–";
      const { bar, beat } = barBeatOf(ctx.grid, g);
      return `${bar}.${beat}`;
    }
  }
}

export function parseTime(text: string, unit: TimeUnit, ctx: TimeCtx): number | null {
  const t = text.trim();
  switch (unit) {
    case "sec": {
      const m = t.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
      if (!m) return null;
      const mins = m[1] ? parseInt(m[1], 10) : 0;
      const secs = parseFloat(m[2]!);
      return Number.isFinite(secs) ? mins * 60 + secs : null;
    }
    case "frame": {
      if (!/^\d+$/.test(t)) return null;
      return frameToTime(parseInt(t, 10), ctx.fps);
    }
    case "tc": {
      const m = t.match(/^(\d+):(\d+):(\d+):(\d+)$/);
      if (!m) return null;
      const base = Math.ceil(ctx.fps.num / ctx.fps.den);
      const [hh, mm, ss, ff] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!];
      if (ff >= base) return null;
      return frameToTime((hh * 3600 + mm * 60 + ss) * base + ff, ctx.fps);
    }
    case "barBeat": {
      const m = t.match(/^(-?\d+)\.(\d+)$/);
      if (!m) return null;
      const bar = +m[1]!;
      const beat = +m[2]!;
      const barStart = ctx.grid.find((b) => b.isBar && b.barNumber === bar);
      if (!barStart || beat < 1) return null;
      const target = ctx.grid.find((b) => b.index === barStart.index + (beat - 1) && b.barNumber === bar);
      return target ? target.timeSec : null;
    }
  }
}
```

- [ ] **Step 3: 失敗するテストを書く(snap)→ 実装**

`app/src/renderer/__tests__/snap.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { deriveGrid } from "../../shared/deriveGrid.js";
import { FPS_PRESETS } from "../../shared/timebase.js";
import type { AnalysisResult } from "../../shared/types.js";
import { defaultEditState } from "../../shared/validate.js";
import { nudgeSec, snapSec } from "../editor/snap.js";
import type { TimeCtx } from "../editor/timeFormat.js";

function ctx(): TimeCtx {
  const a: AnalysisResult = {
    durationSec: 20, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0,
    beats: Array.from({ length: 40 }, (_, i) => i * 0.5), downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [], hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
  };
  return { fps: FPS_PRESETS["30"]!, grid: deriveGrid(a, defaultEditState()) };
}

describe("snapSec", () => {
  const c = ctx();
  it("beat: 最近傍の拍(0.5s間隔)", () => {
    expect(snapSec(0.6, "beat", c)).toBeCloseTo(0.5, 6);
    expect(snapSec(0.8, "beat", c)).toBeCloseTo(1.0, 6);
  });
  it("beat: 等距離タイは早い方(小さい時刻)", () => {
    expect(snapSec(0.75, "beat", c)).toBeCloseTo(0.5, 6);
  });
  it("bar: 最近傍の小節(2s間隔)", () => {
    expect(snapSec(2.9, "bar", c)).toBeCloseTo(2.0, 6);
    expect(snapSec(3.1, "bar", c)).toBeCloseTo(4.0, 6);
  });
  it("frame: 30fps グリッド(1/30秒)へ丸め", () => {
    expect(snapSec(0.02, "frame", c)).toBeCloseTo(1 / 30, 6); // 0.02→round(0.6f)=1f
    expect(snapSec(0.01, "frame", c)).toBeCloseTo(0, 6);
  });
  it("none: 恒等", () => {
    expect(snapSec(1.2345, "none", c)).toBe(1.2345);
  });
  it("グリッド空でも beat/bar は恒等(スナップ先なし)", () => {
    const empty: TimeCtx = { fps: c.fps, grid: [] };
    expect(snapSec(1.2, "beat", empty)).toBe(1.2);
    expect(snapSec(1.2, "bar", empty)).toBe(1.2);
  });
});

describe("nudgeSec", () => {
  it("fine=true は ±1ms、fine=false は ±10ms", () => {
    expect(nudgeSec(1.0, 1, true)).toBeCloseTo(1.001, 6);
    expect(nudgeSec(1.0, -1, true)).toBeCloseTo(0.999, 6);
    expect(nudgeSec(1.0, 1, false)).toBeCloseTo(1.01, 6);
    expect(nudgeSec(1.0, -1, false)).toBeCloseTo(0.99, 6);
  });
});
```

`app/src/renderer/editor/snap.ts`:

```ts
/** スナップ(拍/小節/フレーム/なし)と nudge(±1ms/±10ms)。純ロジック(スペック §7)。 */
import { barsOf } from "../../shared/deriveGrid.js";
import { frameToTime, timeToFrame } from "../../shared/timebase.js";
import type { TimeCtx } from "./timeFormat.js";

export type SnapMode = "beat" | "bar" | "frame" | "none";

/** ソート済み時刻配列 times の中で sec に最も近い値。タイは早い方(小さい方)。 */
function nearest(times: number[], sec: number): number | null {
  if (times.length === 0) return null;
  let best = times[0]!;
  let bestD = Math.abs(best - sec);
  for (let i = 1; i < times.length; i++) {
    const d = Math.abs(times[i]! - sec);
    if (d < bestD) { best = times[i]!; bestD = d; } // strict < なので同距離は先着(早い)を保持
  }
  return best;
}

export function snapSec(sec: number, mode: SnapMode, ctx: TimeCtx): number {
  switch (mode) {
    case "none":
      return sec;
    case "frame":
      return frameToTime(timeToFrame(sec, ctx.fps, "nearest"), ctx.fps);
    case "beat":
      return nearest(ctx.grid.map((g) => g.timeSec), sec) ?? sec;
    case "bar":
      return nearest(barsOf(ctx.grid).map((g) => g.timeSec), sec) ?? sec;
  }
}

export function nudgeSec(sec: number, dir: 1 | -1, fine: boolean): number {
  return sec + dir * (fine ? 0.001 : 0.01);
}
```

- [ ] **Step 4: 失敗するテストを書く(viewStore)→ 実装**

`app/src/renderer/__tests__/viewStore.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { initialViewState, viewReducer, type ViewState } from "../state/viewStore.js";

describe("viewReducer", () => {
  it("SET_VIEW は指定フィールドのみ更新", () => {
    const s = viewReducer(initialViewState(), { type: "SET_VIEW", scrollSec: 12 });
    expect(s.scrollSec).toBe(12);
    expect(s.zoomSamplesPerPx).toBe(initialViewState().zoomSamplesPerPx);
  });

  it("CYCLE_TIME_UNIT は sec→frame→tc→barBeat→sec と巡回", () => {
    let s: ViewState = { ...initialViewState(), timeUnit: "sec" };
    const seq = [] as string[];
    for (let i = 0; i < 5; i++) { s = viewReducer(s, { type: "CYCLE_TIME_UNIT" }); seq.push(s.timeUnit); }
    expect(seq).toEqual(["frame", "tc", "barBeat", "sec", "frame"]);
  });

  it("TOGGLE_LANE は該当レーンだけ反転", () => {
    const s = viewReducer(initialViewState(), { type: "TOGGLE_LANE", lane: "hits" });
    expect(s.laneVisibility.hits).toBe(false);
    expect(s.laneVisibility.beatGrid).toBe(true);
  });

  it("SET_SNAP / SET_LOOP / SET_FOLLOW", () => {
    let s = viewReducer(initialViewState(), { type: "SET_SNAP", mode: "bar" });
    expect(s.snapMode).toBe("bar");
    s = viewReducer(s, { type: "SET_LOOP", loop: { a: 1, b: 2 } });
    expect(s.loop).toEqual({ a: 1, b: 2 });
    s = viewReducer(s, { type: "SET_LOOP", loop: null });
    expect(s.loop).toBeNull();
    s = viewReducer(s, { type: "SET_FOLLOW", on: false });
    expect(s.followPlayhead).toBe(false);
  });
});
```

`app/src/renderer/state/viewStore.ts`:

```ts
/** エディタ表示状態(zoom/scroll/snap/timeUnit/レーン表示/ループ/追従)。undo 対象外(スペック §7)。
 *  React context + useReducer。純 reducer は直接テストできるよう export する。 */
import React, { createContext, useContext, useReducer } from "react";

import type { SnapMode } from "../editor/snap.js";
import type { TimeUnit } from "../editor/timeFormat.js";

export interface LaneVisibility {
  beatGrid: boolean;
  sections: boolean;
  hits: boolean;
  silence: boolean;
}

export interface ViewState {
  zoomSamplesPerPx: number; // 波形の水平密度(サンプル/px)
  scrollSec: number;        // 表示左端の曲内秒
  snapMode: SnapMode;
  timeUnit: TimeUnit;
  laneVisibility: LaneVisibility;
  loop: { a: number; b: number } | null;
  followPlayhead: boolean;
}

export type ViewAction =
  | { type: "SET_VIEW"; scrollSec?: number; zoomSamplesPerPx?: number }
  | { type: "SET_SNAP"; mode: SnapMode }
  | { type: "SET_TIME_UNIT"; unit: TimeUnit }
  | { type: "CYCLE_TIME_UNIT" }
  | { type: "TOGGLE_LANE"; lane: keyof LaneVisibility }
  | { type: "SET_LOOP"; loop: { a: number; b: number } | null }
  | { type: "SET_FOLLOW"; on: boolean };

const UNIT_ORDER: TimeUnit[] = ["sec", "frame", "tc", "barBeat"];

export function initialViewState(): ViewState {
  return {
    zoomSamplesPerPx: 1024,
    scrollSec: 0,
    snapMode: "beat",
    timeUnit: "tc",
    laneVisibility: { beatGrid: true, sections: true, hits: true, silence: true },
    loop: null,
    followPlayhead: true,
  };
}

export function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case "SET_VIEW":
      return {
        ...state,
        scrollSec: action.scrollSec ?? state.scrollSec,
        zoomSamplesPerPx: action.zoomSamplesPerPx ?? state.zoomSamplesPerPx,
      };
    case "SET_SNAP":
      return { ...state, snapMode: action.mode };
    case "SET_TIME_UNIT":
      return { ...state, timeUnit: action.unit };
    case "CYCLE_TIME_UNIT": {
      const i = UNIT_ORDER.indexOf(state.timeUnit);
      return { ...state, timeUnit: UNIT_ORDER[(i + 1) % UNIT_ORDER.length]! };
    }
    case "TOGGLE_LANE":
      return {
        ...state,
        laneVisibility: { ...state.laneVisibility, [action.lane]: !state.laneVisibility[action.lane] },
      };
    case "SET_LOOP":
      return { ...state, loop: action.loop };
    case "SET_FOLLOW":
      return { ...state, followPlayhead: action.on };
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

interface ViewStoreValue {
  view: ViewState;
  dispatch: React.Dispatch<ViewAction>;
}

const ViewStoreContext = createContext<ViewStoreValue | null>(null);

export function ViewStoreProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const [view, dispatch] = useReducer(viewReducer, undefined, initialViewState);
  return React.createElement(ViewStoreContext.Provider, { value: { view, dispatch } }, props.children);
}

export function useViewStore(): ViewStoreValue {
  const v = useContext(ViewStoreContext);
  if (!v) throw new Error("useViewStore は ViewStoreProvider の内側で使う必要があります");
  return v;
}
```

- [ ] **Step 5: 全テスト + typecheck で検証**

Run: `npx vitest run src/renderer/__tests__/timeFormat.test.ts src/renderer/__tests__/snap.test.ts src/renderer/__tests__/viewStore.test.ts && npx tsc --noEmit`
Expected: timeFormat 11 + snap 7 + viewStore 4 = 22 passed、typecheck OK

- [ ] **Step 6: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/renderer/editor/timeFormat.ts app/src/renderer/editor/snap.ts app/src/renderer/state/viewStore.ts \
  app/src/renderer/__tests__/timeFormat.test.ts app/src/renderer/__tests__/snap.test.ts app/src/renderer/__tests__/viewStore.test.ts
git commit -m "feat(app): 時刻format/parse・スナップ/nudge・表示状態viewStore

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SR5fj8BNeN6TUFgoj4zhm6"
```

---

### Task 4: playback拡張+トランスポート

> **完了(2026-07-13, commit 1fcfa4c)**: レビュー verdict Yes・266/266。③a持ち越し2件(シーク時stale click停止 / resume()明示)を実質消化(全状態遷移パスで停止 — 計画要求より広い)。逸脱2件は正当なバグ修正: ①strings.ts へ prevTitle 追加(標準指示) ②btn の border ショートハンド/ロングハンド衝突(React の style diff でトグルOFF時に境界線が消える実バグ — RTLのReact警告で発見・ロングハンド化)。
> **T12への追加指示**: (a) タップテンポのコンポーネント配線RTLテスト(2秒リセット・onTapTempoガード) (b) onEnded が pause/seek/dispose では発火しないネガティブテスト を統合時に追加。

**Files:**
- Modify: `app/src/renderer/audio/playback.ts`(seek時のstale click停止・ctx.resume明示・onEndedフック)
- Create: `app/src/renderer/editor/tapTempo.ts`(タップテンポ純ロジック)
- Create: `app/src/renderer/components/Transport.tsx`
- Test: `app/src/renderer/__tests__/playback-ext.test.ts`
- Test: `app/src/renderer/__tests__/tapTempo.test.ts`
- Test: `app/src/renderer/__tests__/components/Transport.test.tsx`

**Interfaces:**
- Consumes: `audio/playback.ts`(PlaybackEngine)、`state/viewStore.ts`(useViewStore)、`editor/timeFormat.ts`(formatTime)、`shared/deriveGrid.ts`(GridBeat/barsOf)、`shared/types.ts`(Fps)、`shared/timebase.ts`(fpsLabel)、`strings.ts`
- Produces(契約どおり):
  - `createPlayback(ctxFactory?, opts?: { onEnded?: () => void })` — 既存の無引数呼び出しは不変。seek時に予約済みメトロノームクリック osc を stop、play() 冒頭で `ctx.state==="suspended"` なら resume()、自然終了で `opts.onEnded` を発火
  - `tapsToBpm(times: number[]): number | null` — ms タイムスタンプ列(≥4)→ 区間の中央値 → BPM
  - `Transport` props: `{ playback, grid, fps, onAddMarker(sec), onTapTempo(bpm) }`(時刻表示単位/スナップ/ループは viewStore 経由)

> **契約補正**: `createPlayback` に第2引数 `opts` を追加(既定 `{}`)。既存 API・既存10テストは不変。Transport は表示単位を prop でなく viewStore(useViewStore)から取り契約の prop 一覧を守る。ループの A/B 精密設定・ズームスライダは T5/T12(ここでは A/B セット+ループ ON/OFF のみ)。

- [ ] **Step 1: 失敗するテストを書く(playback拡張)**

`app/src/renderer/__tests__/playback-ext.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPlayback } from "../audio/playback.js";

interface FakeNode {
  connect: (d?: unknown) => unknown;
  disconnect: () => void;
  start: (...a: number[]) => void;
  stop: (...a: number[]) => void;
  onended: (() => void) | null;
  buffer?: unknown;
  frequency?: { value: number };
  gain?: { setValueAtTime: (...a: number[]) => void; exponentialRampToValueAtTime: (...a: number[]) => void };
}
function node(extra: Partial<FakeNode> = {}): FakeNode {
  return { connect: vi.fn((d?: unknown) => d), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null, ...extra };
}

function fakeCtx(opts: { state?: string } = {}) {
  const oscillators: FakeNode[] = [];
  const buffers: FakeNode[] = [];
  const raw = {
    currentTime: 0,
    state: opts.state ?? "running",
    destination: {},
    resume: vi.fn(async () => { raw.state = "running"; }),
    decodeAudioData: vi.fn(async () => ({ duration: 10 }) as unknown as AudioBuffer),
    createBufferSource: vi.fn(() => { const n = node(); buffers.push(n); return n; }),
    createOscillator: vi.fn(() => { const n = node({ frequency: { value: 0 } }); oscillators.push(n); return n; }),
    createGain: vi.fn(() => node({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } })),
    close: vi.fn(async () => {}),
  };
  return { raw, oscillators, buffers };
}

describe("playback 拡張", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("play() は ctx が suspended なら resume() する", async () => {
    const { raw } = fakeCtx({ state: "suspended" });
    const pb = createPlayback(() => raw as unknown as AudioContext);
    await pb.load(new ArrayBuffer(8));
    pb.play();
    expect(raw.resume).toHaveBeenCalledTimes(1);
    pb.dispose();
  });

  it("seek 時に予約済みメトロノームクリックの osc を停止する", async () => {
    const f = fakeCtx();
    const pb = createPlayback(() => f.raw as unknown as AudioContext);
    await pb.load(new ArrayBuffer(8));
    pb.updateGrid([{ timeSec: 0.15, isBar: true }, { timeSec: 0.2, isBar: false }]);
    pb.setMetronome(true);
    pb.play(0);
    // pump を1回進めてクリックを予約(0..0.3s窓に2拍入る)
    f.raw.currentTime = 0.01;
    vi.advanceTimersByTime(100);
    expect(f.oscillators.length).toBeGreaterThan(0);
    const before = f.oscillators.map((o) => (o.disconnect as ReturnType<typeof vi.fn>).mock.calls.length);
    pb.seek(5); // ジャンプ → 予約済みクリックは無効化されるべき
    const after = f.oscillators.map((o) => (o.disconnect as ReturnType<typeof vi.fn>).mock.calls.length);
    expect(after.some((n, i) => n > before[i]!)).toBe(true);
    pb.dispose();
  });

  it("自然終了で onEnded コールバックが呼ばれる", async () => {
    const onEnded = vi.fn();
    const f = fakeCtx();
    const pb = createPlayback(() => f.raw as unknown as AudioContext, { onEnded });
    await pb.load(new ArrayBuffer(8));
    pb.play();
    const bufNode = f.buffers[f.buffers.length - 1]!;
    f.raw.currentTime = 20; // duration(10) 超過
    bufNode.onended?.();
    expect(onEnded).toHaveBeenCalledTimes(1);
    pb.dispose();
  });
});
```

- [ ] **Step 2: テスト失敗を確認 → playback.ts を実装**

Run: `npx vitest run src/renderer/__tests__/playback-ext.test.ts`
Expected: FAIL(resume 未呼び出し・onEnded 未対応)

`app/src/renderer/audio/playback.ts` を次の全文に置き換え(既存挙動を保持し、① onEnded オプション ② seek/stop 時のクリック停止 ③ resume 明示 を追加):

```ts
/** Web Audio 再生+メトロノーム(スペック §7)。クリックは拍=1046Hz、小節頭=1568Hz の
 *  減衰サイン。スケジューリングは lookahead 方式(100ms間隔で300ms先まで予約)。 */

export interface GridClick { timeSec: number; isBar: boolean }

export function clicksInWindow(
  beats: GridClick[], fromSec: number, toSec: number,
): GridClick[] {
  if (toSec <= fromSec) return [];
  return beats.filter((b) => b.timeSec >= fromSec && b.timeSec < toSec);
}

const LOOKAHEAD_MS = 100;
const SCHEDULE_AHEAD_SEC = 0.3;

export interface PlaybackEngine {
  load(bytes: ArrayBuffer): Promise<void>;
  play(fromSec?: number): void;
  pause(): void;
  stop(): void;
  seek(sec: number): void;
  currentTime(): number;
  isPlaying(): boolean;
  durationSec(): number;
  setLoop(a: number | null, b: number | null): void;
  setMetronome(on: boolean): void;
  updateGrid(beats: GridClick[]): void;
  dispose(): void;
}

export interface PlaybackOptions {
  onEnded?: () => void; // 自然終了(バッファ終端)時に1回だけ呼ばれる
}

export function createPlayback(
  ctxFactory: () => AudioContext = () => new AudioContext(),
  opts: PlaybackOptions = {},
): PlaybackEngine {
  let ctx: AudioContext | null = null;
  let buffer: AudioBuffer | null = null;
  let srcNode: AudioBufferSourceNode | null = null;
  let startedAtCtx = 0;
  let startOffset = 0;
  let playing = false;
  let loopA: number | null = null;
  let loopB: number | null = null;
  let metronome = false;
  let grid: GridClick[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let scheduledUntil = 0;
  let disposed = false;
  // 予約済みメトロノームクリック osc。seek/stop で未発火分を止める(スペック §7/③a持ち越し)。
  let scheduledClicks: OscillatorNode[] = [];

  function ensureCtx(): AudioContext {
    if (!ctx) ctx = ctxFactory();
    return ctx;
  }

  function click(atCtxTime: number, isBar: boolean): void {
    const c = ensureCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.value = isBar ? 1568 : 1046;
    gain.gain.setValueAtTime(0.6, atCtxTime);
    gain.gain.exponentialRampToValueAtTime(0.001, atCtxTime + 0.06);
    osc.connect(gain).connect(c.destination);
    osc.start(atCtxTime);
    osc.stop(atCtxTime + 0.08);
    scheduledClicks.push(osc);
    osc.onended = () => { scheduledClicks = scheduledClicks.filter((o) => o !== osc); };
  }

  function stopScheduledClicks(): void {
    for (const osc of scheduledClicks) {
      try { osc.stop(); } catch { /* already stopped/scheduled */ }
      try { osc.disconnect(); } catch { /* noop */ }
    }
    scheduledClicks = [];
  }

  function pump(): void {
    if (!playing) return;
    const now = currentTime();
    if (loopA !== null && loopB !== null && now >= loopB) {
      seekInternal(loopA, true);
      return;
    }
    if (!metronome) return;
    const from = Math.max(scheduledUntil, now);
    const to = now + SCHEDULE_AHEAD_SEC;
    for (const b of clicksInWindow(grid, from, to)) {
      click(startedAtCtx + (b.timeSec - startOffset), b.isBar);
    }
    scheduledUntil = to;
  }

  function seekInternal(sec: number, keepPlaying: boolean): void {
    const wasPlaying = playing;
    stopNode();
    startOffset = Math.max(0, Math.min(sec, durationSec()));
    if (keepPlaying && wasPlaying) startNode();
  }

  function startNode(): void {
    const c = ensureCtx();
    if (!buffer) return;
    const node = c.createBufferSource();
    node.buffer = buffer;
    node.connect(c.destination);
    node.onended = () => {
      if (srcNode !== node) return;
      startOffset = currentTime();
      srcNode = null;
      playing = false;
      if (timer) { clearInterval(timer); timer = null; }
      stopScheduledClicks();
      opts.onEnded?.(); // 自然終了フック(seek/pause/stopの差し替え発火では上のguardで抜ける)
    };
    srcNode = node;
    node.start(0, startOffset);
    startedAtCtx = c.currentTime;
    scheduledUntil = startOffset;
    playing = true;
    if (!timer) timer = setInterval(pump, LOOKAHEAD_MS);
  }

  function stopNode(): void {
    if (srcNode) {
      try { srcNode.stop(); } catch { /* already stopped */ }
      srcNode.disconnect();
      srcNode = null;
    }
    if (playing) startOffset = currentTime();
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
    stopScheduledClicks(); // 停止時も未発火クリックを掃除
  }

  function currentTime(): number {
    if (!playing || !ctx) return startOffset;
    return Math.min(startOffset + (ctx.currentTime - startedAtCtx), durationSec());
  }

  function durationSec(): number {
    return buffer?.duration ?? 0;
  }

  return {
    async load(bytes: ArrayBuffer): Promise<void> {
      if (disposed) return;
      const c = ensureCtx();
      const decoded = await c.decodeAudioData(bytes.slice(0));
      if (disposed) return;
      buffer = decoded;
    },
    play(fromSec?: number): void {
      if (playing) return;
      const c = ensureCtx();
      // ブラウザ/Electron のオートプレイ制約対策(③a持ち越し): suspended なら resume
      if (c.state === "suspended") void c.resume();
      if (fromSec !== undefined) startOffset = fromSec;
      if (startOffset >= durationSec()) startOffset = 0;
      startNode();
    },
    pause(): void { stopNode(); },
    stop(): void { stopNode(); startOffset = 0; },
    seek(sec: number): void { seekInternal(sec, true); },
    currentTime,
    isPlaying: () => playing,
    durationSec,
    setLoop(a, b) { loopA = a; loopB = b; },
    setMetronome(on) {
      metronome = on;
      scheduledUntil = currentTime();
      if (!on) stopScheduledClicks(); // OFF で即消音
    },
    updateGrid(beats) {
      grid = beats;
      scheduledUntil = currentTime();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopNode();
      void ctx?.close();
      ctx = null;
    },
  };
}
```

- [ ] **Step 3: playback の既存+新規テストが通ることを確認**

Run: `npx vitest run src/renderer/__tests__/playback.test.ts src/renderer/__tests__/playback-ext.test.ts`
Expected: 既存 10 + 新規 3 = 13 passed(既存フェイクctxは `state` を持たず resume は呼ばれない→不変)

- [ ] **Step 4: 失敗するテストを書く(tapTempo)→ 実装**

`app/src/renderer/__tests__/tapTempo.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { tapsToBpm } from "../editor/tapTempo.js";

describe("tapsToBpm", () => {
  it("4タップ未満は null", () => {
    expect(tapsToBpm([])).toBeNull();
    expect(tapsToBpm([0, 500, 1000])).toBeNull();
  });
  it("500ms等間隔 → 120BPM", () => {
    expect(tapsToBpm([0, 500, 1000, 1500, 2000])!).toBeCloseTo(120, 3);
  });
  it("外れ値1つは中央値で吸収される", () => {
    // 500ms間隔に1回だけ大きな間(2000ms)が混ざっても中央値は500付近
    expect(tapsToBpm([0, 500, 1000, 3000, 3500, 4000])!).toBeCloseTo(120, 0);
  });
  it("順不同でもソートして処理", () => {
    expect(tapsToBpm([1500, 0, 1000, 500])!).toBeCloseTo(120, 3);
  });
});
```

`app/src/renderer/editor/tapTempo.ts`:

```ts
/** タップテンポ: 打点タイムスタンプ(ms)列 → 区間の中央値 → BPM(スペック §7)。 */
export function tapsToBpm(times: number[]): number | null {
  if (times.length < 4) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i]! - sorted[i - 1]!);
  intervals.sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  const median = intervals.length % 2 ? intervals[mid]! : (intervals[mid - 1]! + intervals[mid]!) / 2;
  if (median <= 0) return null;
  const bpm = 60000 / median;
  return Number.isFinite(bpm) && bpm > 0 ? bpm : null;
}
```

- [ ] **Step 5: 失敗するテストを書く(Transport RTL)**

`app/src/renderer/__tests__/components/Transport.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";

import { FPS_PRESETS } from "../../../shared/timebase.js";
import type { PlaybackEngine } from "../../audio/playback.js";
import { Transport } from "../../components/Transport.js";
import { ViewStoreProvider } from "../../state/viewStore.js";
import { STRINGS } from "../../strings.js";

function fakePlayback(over: Partial<PlaybackEngine> = {}): PlaybackEngine {
  return {
    load: vi.fn(async () => {}), play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(),
    currentTime: vi.fn(() => 42), isPlaying: vi.fn(() => false), durationSec: vi.fn(() => 210),
    setLoop: vi.fn(), setMetronome: vi.fn(), updateGrid: vi.fn(), dispose: vi.fn(), ...over,
  };
}

function renderTransport(pb: PlaybackEngine, cb: { onAddMarker?: (s: number) => void; onTapTempo?: (b: number) => void } = {}) {
  return render(
    <ViewStoreProvider>
      <Transport
        playback={pb} grid={[]} fps={FPS_PRESETS["30"]!}
        onAddMarker={cb.onAddMarker ?? vi.fn()} onTapTempo={cb.onTapTempo ?? vi.fn()}
      />
    </ViewStoreProvider>,
  );
}

describe("Transport", () => {
  it("手動マーカーボタンで現在時刻を渡してコールバック", () => {
    const onAddMarker = vi.fn();
    const pb = fakePlayback({ currentTime: vi.fn(() => 42) });
    renderTransport(pb, { onAddMarker });
    fireEvent.click(screen.getByText(STRINGS.transport.addMarker));
    expect(onAddMarker).toHaveBeenCalledWith(42);
  });

  it("メトロノームトグルで playback.setMetronome(true) を呼ぶ", () => {
    const pb = fakePlayback();
    renderTransport(pb);
    fireEvent.click(screen.getByText(STRINGS.transport.metronome));
    expect(pb.setMetronome).toHaveBeenCalledWith(true);
  });

  it("再生ボタンで play()、再クリックで pause()", () => {
    let flag = false;
    const pb = fakePlayback({ play: vi.fn(() => { flag = true; }), pause: vi.fn(() => { flag = false; }), isPlaying: vi.fn(() => flag) });
    renderTransport(pb);
    fireEvent.click(screen.getByText(STRINGS.transport.play));
    expect(pb.play).toHaveBeenCalled();
    fireEvent.click(screen.getByText(STRINGS.transport.pause));
    expect(pb.pause).toHaveBeenCalled();
  });

  it("ループトグル: ON で setLoop(範囲)、再クリックで setLoop(null,null)", () => {
    const pb = fakePlayback({ currentTime: vi.fn(() => 10) });
    renderTransport(pb);
    const loopBtn = screen.getByText(STRINGS.transport.loop);
    fireEvent.click(loopBtn);
    expect(pb.setLoop).toHaveBeenLastCalledWith(10, expect.any(Number));
    fireEvent.click(loopBtn);
    expect(pb.setLoop).toHaveBeenLastCalledWith(null, null);
  });
});
```

- [ ] **Step 6: テスト失敗を確認 → Transport.tsx を実装**

Run: `npx vitest run src/renderer/__tests__/components/Transport.test.tsx`
Expected: FAIL — `Cannot find module '../../components/Transport.js'`

`app/src/renderer/components/Transport.tsx`:

```tsx
/** トランスポート(スペック §7 ①): 再生/ループ/TC表示/メトロノーム/タップテンポ/手動マーカー。
 *  モックの toolbar1 相当。表示単位・スナップ・ループは viewStore を参照する。 */
import React, { useEffect, useRef, useState } from "react";

import type { GridBeat } from "../../shared/deriveGrid.js";
import { barsOf } from "../../shared/deriveGrid.js";
import { fpsLabel } from "../../shared/timebase.js";
import type { Fps } from "../../shared/types.js";
import type { PlaybackEngine } from "../audio/playback.js";
import { tapsToBpm } from "../editor/tapTempo.js";
import { formatTime } from "../editor/timeFormat.js";
import { useViewStore } from "../state/viewStore.js";
import { STRINGS } from "../strings.js";

const S = STRINGS.transport;

const groupStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, background: "#191d24",
  border: "1px solid #262c36", borderRadius: 8, padding: "4px 8px",
};
const btn: React.CSSProperties = {
  background: "#1f242d", color: "#e8ebf0", border: "1px solid #262c36",
  borderRadius: 6, padding: "4px 9px", fontSize: 11, cursor: "pointer",
};
const toggled: React.CSSProperties = { ...btn, background: "#2a3140", borderColor: "#ffd166", color: "#ffd166" };
const primary: React.CSSProperties = { ...btn, background: "#ff4d6b", borderColor: "#ff4d6b", color: "#fff", fontWeight: 700 };

/** グリッドから小節長(秒)を推定。無ければ 2 秒。 */
function barLenSec(grid: GridBeat[]): number {
  const bars = barsOf(grid);
  return bars.length >= 2 ? bars[1]!.timeSec - bars[0]!.timeSec : 2;
}

export interface TransportProps {
  playback: PlaybackEngine;
  grid: GridBeat[];
  fps: Fps;
  onAddMarker: (sec: number) => void;
  onTapTempo: (bpm: number) => void;
}

export function Transport(props: TransportProps): React.JSX.Element {
  const { playback, grid, fps } = props;
  const { view, dispatch } = useViewStore();
  const [playing, setPlaying] = useState(playback.isPlaying());
  const [metronome, setMetronome] = useState(false);
  const [, forceTick] = useState(0);
  const taps = useRef<number[]>([]);

  // 再生中は 100ms ごとに時刻表示を更新
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => forceTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [playing]);

  function togglePlay(): void {
    if (playback.isPlaying()) { playback.pause(); setPlaying(false); }
    else { playback.play(); setPlaying(true); }
  }

  function toggleMetronome(): void {
    const next = !metronome;
    setMetronome(next);
    playback.setMetronome(next);
  }

  function toggleLoop(): void {
    if (view.loop) {
      dispatch({ type: "SET_LOOP", loop: null });
      playback.setLoop(null, null);
    } else {
      const a = playback.currentTime();
      const b = Math.min(a + barLenSec(grid), playback.durationSec());
      dispatch({ type: "SET_LOOP", loop: { a, b } });
      playback.setLoop(a, b);
    }
  }

  function setLoopEdge(edge: "a" | "b"): void {
    const t = playback.currentTime();
    const cur = view.loop ?? { a: t, b: t };
    const loop = edge === "a" ? { a: t, b: Math.max(cur.b, t) } : { a: Math.min(cur.a, t), b: t };
    dispatch({ type: "SET_LOOP", loop });
    playback.setLoop(loop.a, loop.b);
  }

  function tap(): void {
    const now = performance.now();
    if (taps.current.length && now - taps.current[taps.current.length - 1]! > 2000) taps.current = [];
    taps.current.push(now);
    const bpm = tapsToBpm(taps.current);
    if (bpm !== null) props.onTapTempo(bpm);
  }

  const tc = formatTime(playback.currentTime(), view.timeUnit, { fps, grid });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", background: "#14171c", borderBottom: "1px solid #262c36" }}>
      <div style={groupStyle}>
        <button style={btn} title="先頭へ" onClick={() => playback.seek(0)}>{S.prev}</button>
        <button style={primary} onClick={togglePlay}>{playing ? S.pause : S.play}</button>
        <button style={view.loop ? toggled : btn} onClick={toggleLoop}>{S.loop}</button>
        <button style={btn} disabled={!view.loop} onClick={() => setLoopEdge("a")}>{S.setA}</button>
        <button style={btn} disabled={!view.loop} onClick={() => setLoopEdge("b")}>{S.setB}</button>
      </div>

      <div
        title={S.cycleUnitTitle}
        onClick={() => dispatch({ type: "CYCLE_TIME_UNIT" })}
        style={{
          fontFamily: "monospace", fontSize: 16, fontWeight: 600, letterSpacing: 1,
          background: "#0a0c10", border: "1px solid #262c36", borderRadius: 6, padding: "4px 12px", cursor: "pointer",
        }}
      >
        {tc}
        <small style={{ color: "#5a6272", fontSize: 10, marginLeft: 6 }}>@ {fpsLabel(fps)}{S.fpsDisplaySuffix}</small>
      </div>

      <div style={groupStyle}>
        <span style={{ color: "#5a6272", fontSize: 10 }}>{S.confirmGroup}</span>
        <button style={metronome ? toggled : btn} onClick={toggleMetronome}>{S.metronome}</button>
        <button style={btn} onClick={tap}>{S.tapTempo}</button>
      </div>

      <div style={groupStyle}>
        <span style={{ color: "#5a6272", fontSize: 10 }}>{S.addGroup}</span>
        <button style={btn} onClick={() => props.onAddMarker(playback.currentTime())}>{S.addMarker}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: 全テスト + typecheck で検証**

Run: `npx vitest run src/renderer/__tests__/tapTempo.test.ts src/renderer/__tests__/components/Transport.test.tsx && npx tsc --noEmit`
Expected: tapTempo 4 + Transport 4 = 8 passed(playback 13 と合わせ Task4 新規 11)、typecheck OK

- [ ] **Step 8: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/renderer/audio/playback.ts app/src/renderer/editor/tapTempo.ts app/src/renderer/components/Transport.tsx \
  app/src/renderer/__tests__/playback-ext.test.ts app/src/renderer/__tests__/tapTempo.test.ts app/src/renderer/__tests__/components/Transport.test.tsx
git commit -m "feat(app): playback拡張(seek時click停止/resume/onEnded)+トランスポートUI

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SR5fj8BNeN6TUFgoj4zhm6"
```

---

### Task 5: メイン波形Canvas+座標系/ヒットテスト

**Files:**
- Create: `app/src/renderer/editor/waveGeom.ts`(座標変換・可視要素抽出・ヒットテスト — 純ロジック)
- Create: `app/src/renderer/components/WaveCanvas.tsx`(自前Canvas描画・ポインタ操作)
- Test: `app/src/renderer/__tests__/waveGeom.test.ts`
- Test: `app/src/renderer/__tests__/components/WaveCanvas.test.tsx`

**Interfaces:**
- Consumes: `editor/peaks.ts`(PeakSet/pickLevel)、`editor/snap.ts`(snapSec)、`editor/timeFormat.ts`(TimeCtx)、`state/viewStore.ts`、`shared/deriveGrid.ts`(GridBeat)、`shared/types.ts`(Marker/MarkerType)、`shared/deriveMarkers.ts`(色定数)
- Produces(契約どおり + WaveLayout を本タスクで定義):
  - `Viewport { scrollSec; samplesPerPx; sampleRate; widthPx }`
  - `secToPx` / `pxToSec` / `visibleRange` / `zoomAt(vp, factor, anchorPx)`(カーソル中心ズーム)
  - `WaveHit` / `WaveLayout` / `hitTest(px, py, layout)`
  - 可視要素の純抽出: `visibleGridLines` / `adaptiveBarStep` / `visibleMarkerTicks` / `silenceRegionsFromMarkers` / `freeZoneEndSec`
  - `paintWave(ctx2d, params): PaintStats`(描画+検証用の件数を返す。純関数寄りでフェイクctxテスト可)

> **WaveLayout 設計(本タスクで確定)**: `{ viewport: Viewport; heightPx: number; anchorSec: number|null; sectionBoundaries: {index,id,sec}[]; markers: {id,sec,type}[] }`。hitTest 優先度は anchor > sectionBoundary > marker > background(いずれも px 許容差で判定)。sectionBoundary の `index` は元セクション添字(`sec-o{i}` 由来、T6 の move と整合)。静寂は `sil-{i}-in` マーカーの `meta.durationSec` を使ってリージョン化(deriveMarkers は IN/OUT の2点マーカーで表現)。フリー区間の減光は `deriveGrid` の `free=true`(アンカー前)から先頭の非フリー拍時刻を境界に用いる。WaveCanvas はロジックを waveGeom に寄せた薄い描画層とし、jsdom に実canvasが無いためテストは純関数中心+フェイク2Dコンテキストの描画呼び出し検証にする。

- [ ] **Step 1: 失敗するテストを書く(waveGeom)**

`app/src/renderer/__tests__/waveGeom.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { deriveGrid } from "../../shared/deriveGrid.js";
import type { AnalysisResult, Marker } from "../../shared/types.js";
import { defaultEditState } from "../../shared/validate.js";
import {
  adaptiveBarStep, freeZoneEndSec, hitTest, pxToSec, secToPx,
  silenceRegionsFromMarkers, visibleGridLines, visibleRange, zoomAt,
  type Viewport, type WaveLayout,
} from "../editor/waveGeom.js";

const VP: Viewport = { scrollSec: 10, samplesPerPx: 441, sampleRate: 44100, widthPx: 1000 };
// samplesPerPx/sampleRate = 0.01 s/px → 1000px = 10s 表示

describe("座標変換", () => {
  it("secToPx / pxToSec は逆変換", () => {
    expect(secToPx(10, VP)).toBeCloseTo(0, 6);
    expect(secToPx(20, VP)).toBeCloseTo(1000, 6);
    expect(pxToSec(0, VP)).toBeCloseTo(10, 6);
    expect(pxToSec(500, VP)).toBeCloseTo(15, 6);
    expect(pxToSec(secToPx(13.7, VP), VP)).toBeCloseTo(13.7, 6);
  });
  it("visibleRange は左端〜右端の秒", () => {
    const r = visibleRange(VP);
    expect(r.fromSec).toBeCloseTo(10, 6);
    expect(r.toSec).toBeCloseTo(20, 6);
  });
});

describe("zoomAt(カーソル中心)", () => {
  it("ズームインしてもアンカー px の時刻は不変", () => {
    const anchorPx = 300;
    const before = pxToSec(anchorPx, VP);
    const z = zoomAt(VP, 2, anchorPx); // factor2 = 拡大
    expect(z.samplesPerPx).toBeCloseTo(220.5, 6);
    expect(pxToSec(anchorPx, z)).toBeCloseTo(before, 6);
  });
  it("ズームアウトでもアンカー px の時刻は不変", () => {
    const anchorPx = 700;
    const before = pxToSec(anchorPx, VP);
    const z = zoomAt(VP, 0.5, anchorPx);
    expect(z.samplesPerPx).toBeCloseTo(882, 6);
    expect(pxToSec(anchorPx, z)).toBeCloseTo(before, 6);
  });
});

function gridCtx() {
  const a: AnalysisResult = {
    durationSec: 40, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0,
    beats: Array.from({ length: 80 }, (_, i) => i * 0.5), downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [], hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
  };
  return deriveGrid(a, defaultEditState());
}

describe("可視要素抽出", () => {
  it("visibleGridLines は表示範囲(10..20s, 0.5s間隔)の拍のみ", () => {
    const lines = visibleGridLines(gridCtx(), VP);
    // 10.0,10.5,...,20.0 → 21本(両端含む)
    expect(lines.length).toBe(21);
    expect(lines.every((l) => l.px >= -1 && l.px <= VP.widthPx + 1)).toBe(true);
    expect(lines.filter((l) => l.isBar).length).toBeGreaterThan(0);
  });
  it("adaptiveBarStep は小節間隔が狭いほど間引く", () => {
    // 小節=2s → 2s*100px/s=200px間隔 → step1
    expect(adaptiveBarStep(2, VP, 60)).toBe(1);
    // 表示を大きく縮小(1px=1s相当)すると 2s=2px間隔 → step ceil(60/2)=30
    const wide: Viewport = { ...VP, samplesPerPx: 44100 };
    expect(adaptiveBarStep(2, wide, 60)).toBe(30);
  });
  it("silenceRegionsFromMarkers は sil-*-in を duration 付きリージョン化", () => {
    const markers: Marker[] = [
      { id: "sil-0-in", sourceId: "mix", timeSec: 5, type: "silence", label: "静寂IN", color: "#6b7686", source: "auto", meta: { durationSec: 1.5 } },
      { id: "sil-0-out", sourceId: "mix", timeSec: 6.5, type: "silence", label: "静寂OUT", color: "#6b7686", source: "auto" },
    ];
    expect(silenceRegionsFromMarkers(markers)).toEqual([{ startSec: 5, durSec: 1.5 }]);
  });
  it("freeZoneEndSec: free拍が無ければ null、あれば先頭の非free拍時刻", () => {
    expect(freeZoneEndSec(gridCtx())).toBeNull();
    const withFree = gridCtx().map((g, i) => (i < 3 ? { ...g, free: true } : g));
    expect(freeZoneEndSec(withFree)).toBeCloseTo(withFree[3]!.timeSec, 6);
  });
});

describe("hitTest 優先度", () => {
  const layout: WaveLayout = {
    viewport: VP, heightPx: 200, anchorSec: 12,
    sectionBoundaries: [{ index: 1, id: "sec-o1", sec: 15 }],
    markers: [{ id: "hit-low-3", sec: 18, type: "hit" }],
  };
  it("アンカー旗(上部)を最優先", () => {
    expect(hitTest(secToPx(12, VP), 5, layout)).toEqual({ kind: "anchor" });
  });
  it("セクション境界(上部ハンドル)", () => {
    expect(hitTest(secToPx(15, VP), 5, layout)).toEqual({ kind: "sectionBoundary", index: 1 });
  });
  it("マーカーティック", () => {
    expect(hitTest(secToPx(18, VP), 120, layout)).toEqual({ kind: "marker", id: "hit-low-3" });
  });
  it("何もない所は background", () => {
    expect(hitTest(secToPx(13, VP), 120, layout)).toEqual({ kind: "background" });
  });
});
```

- [ ] **Step 2: テスト失敗を確認 → waveGeom.ts 実装**

Run: `npx vitest run src/renderer/__tests__/waveGeom.test.ts`
Expected: FAIL — `Cannot find module '../editor/waveGeom.js'`

`app/src/renderer/editor/waveGeom.ts`:

```ts
/** メイン波形の座標系(sec↔px)・可視要素抽出・ヒットテスト・描画(スペック §7)。
 *  純ロジックに寄せ、WaveCanvas は薄い描画層にする。 */
import type { GridBeat } from "../../shared/deriveGrid.js";
import { BAR_COLOR, BEAT_COLOR } from "../../shared/deriveMarkers.js";
import type { Marker, MarkerType } from "../../shared/types.js";
import { pickLevel, type PeakSet } from "./peaks.js";

export interface Viewport {
  scrollSec: number;
  samplesPerPx: number;
  sampleRate: number;
  widthPx: number;
}

export function secToPx(sec: number, vp: Viewport): number {
  return ((sec - vp.scrollSec) * vp.sampleRate) / vp.samplesPerPx;
}
export function pxToSec(px: number, vp: Viewport): number {
  return vp.scrollSec + (px * vp.samplesPerPx) / vp.sampleRate;
}
export function visibleRange(vp: Viewport): { fromSec: number; toSec: number } {
  return { fromSec: vp.scrollSec, toSec: pxToSec(vp.widthPx, vp) };
}

/** カーソル中心ズーム: factor>1=拡大(密度↓)。anchorPx の時刻を不変に保つ。 */
export function zoomAt(vp: Viewport, factor: number, anchorPx: number): Viewport {
  const anchorSec = pxToSec(anchorPx, vp);
  const samplesPerPx = vp.samplesPerPx / factor;
  const scrollSec = anchorSec - (anchorPx * samplesPerPx) / vp.sampleRate;
  return { ...vp, samplesPerPx, scrollSec };
}

export interface GridLine { px: number; isBar: boolean; barNumber: number; free: boolean }
export function visibleGridLines(grid: GridBeat[], vp: Viewport): GridLine[] {
  const out: GridLine[] = [];
  for (const g of grid) {
    const px = secToPx(g.timeSec, vp);
    if (px >= -1 && px <= vp.widthPx + 1) {
      out.push({ px, isBar: g.isBar, barNumber: g.barNumber, free: g.free });
    }
  }
  return out;
}

/** 小節番号ラベルの間引きステップ(ラベルが最低 minLabelPx 間隔になるように)。 */
export function adaptiveBarStep(barIntervalSec: number, vp: Viewport, minLabelPx = 60): number {
  const barPx = (barIntervalSec * vp.sampleRate) / vp.samplesPerPx;
  if (barPx <= 0) return 1;
  return Math.max(1, Math.ceil(minLabelPx / barPx));
}

export interface MarkerTick { id: string; px: number; type: MarkerType; color: string }
export function visibleMarkerTicks(markers: Marker[], vp: Viewport): MarkerTick[] {
  const out: MarkerTick[] = [];
  for (const m of markers) {
    const px = secToPx(m.timeSec, vp);
    if (px >= -2 && px <= vp.widthPx + 2) out.push({ id: m.id, px, type: m.type, color: m.color });
  }
  return out;
}

export interface SilenceRegion { startSec: number; durSec: number }
export function silenceRegionsFromMarkers(markers: Marker[]): SilenceRegion[] {
  return markers
    .filter((m) => m.type === "silence" && m.id.endsWith("-in") && m.meta?.durationSec !== undefined)
    .map((m) => ({ startSec: m.timeSec, durSec: m.meta!.durationSec! }));
}

/** アンカー前フリー区間の終端(=先頭の非free拍時刻)。free拍が無ければ null。 */
export function freeZoneEndSec(grid: GridBeat[]): number | null {
  if (!grid.some((g) => g.free)) return null;
  const firstNonFree = grid.find((g) => !g.free);
  return firstNonFree ? firstNonFree.timeSec : null;
}

export type WaveHit =
  | { kind: "anchor" }
  | { kind: "sectionBoundary"; index: number }
  | { kind: "marker"; id: string }
  | { kind: "background" };

export interface WaveLayout {
  viewport: Viewport;
  heightPx: number;
  anchorSec: number | null;
  sectionBoundaries: { index: number; id: string; sec: number }[];
  markers: { id: string; sec: number; type: MarkerType }[];
}

const ANCHOR_HIT_PX = 6;
const FLAG_ZONE_PY = 14;
const BOUNDARY_HIT_PX = 5;
const MARKER_HIT_PX = 4;

export function hitTest(px: number, py: number, layout: WaveLayout): WaveHit {
  const vp = layout.viewport;
  if (layout.anchorSec !== null && py <= FLAG_ZONE_PY &&
      Math.abs(px - secToPx(layout.anchorSec, vp)) <= ANCHOR_HIT_PX) {
    return { kind: "anchor" };
  }
  if (py <= FLAG_ZONE_PY) {
    for (const b of layout.sectionBoundaries) {
      if (Math.abs(px - secToPx(b.sec, vp)) <= BOUNDARY_HIT_PX) return { kind: "sectionBoundary", index: b.index };
    }
  }
  let bestId: string | null = null;
  let bestD = MARKER_HIT_PX + 1;
  for (const m of layout.markers) {
    const d = Math.abs(px - secToPx(m.sec, vp));
    if (d <= MARKER_HIT_PX && d < bestD) { bestD = d; bestId = m.id; }
  }
  if (bestId !== null) return { kind: "marker", id: bestId };
  return { kind: "background" };
}

/** 描画に必要な最小限の2Dコンテキスト面(テストのフェイク差し替え用)。 */
export interface Ctx2D {
  save(): void; restore(): void;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  stroke(): void; fill(): void; fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
  setLineDash(d: number[]): void;
  strokeStyle: string; fillStyle: string; lineWidth: number; font: string; globalAlpha: number;
}

export interface PaintParams {
  layout: WaveLayout;
  peaks: PeakSet | null;
  grid: GridBeat[];
  markers: Marker[];
  playheadSec: number;
  colors?: { beat?: string; bar?: string; playhead?: string; anchor?: string; silence?: string };
}
export interface PaintStats {
  gridLines: number; barLabels: number; markerTicks: number; silenceRects: number;
  drewPlayhead: boolean; drewAnchor: boolean; drewFreeDim: boolean;
}

/** メイン波形を描画し、描いた要素数(検証用)を返す。 */
export function paintWave(ctx: Ctx2D, p: PaintParams): PaintStats {
  const vp = p.layout.viewport;
  const H = p.layout.heightPx;
  const W = vp.widthPx;
  const beatColor = p.colors?.beat ?? BEAT_COLOR;
  const barColor = p.colors?.bar ?? BAR_COLOR;
  const playheadColor = p.colors?.playhead ?? "#ff4d6b";
  const anchorColor = p.colors?.anchor ?? "#ffd166";
  const silenceColor = p.colors?.silence ?? "#6b7686";
  const mid = H / 2;

  ctx.clearRect(0, 0, W, H);

  // (d) 静寂リージョン(薄いハッチ代わりの半透明帯)
  const silences = silenceRegionsFromMarkers(p.markers);
  for (const r of silences) {
    const x = secToPx(r.startSec, vp);
    const w = (r.durSec * vp.sampleRate) / vp.samplesPerPx;
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = silenceColor;
    ctx.fillRect(x, 0, w, H);
    ctx.globalAlpha = 1;
  }

  // (f) フリー区間の減光(アンカー以前)
  const freeEnd = freeZoneEndSec(p.grid);
  let drewFreeDim = false;
  if (freeEnd !== null) {
    const x = secToPx(freeEnd, vp);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#0d0f13";
    ctx.fillRect(0, 0, Math.max(0, x), H);
    ctx.globalAlpha = 1;
    drewFreeDim = true;
  }

  // (a) ピーク(min/max 縦線)
  if (p.peaks && p.peaks.length > 0) {
    const level = pickLevel(p.peaks, vp.samplesPerPx);
    const bucketsPerPx = vp.samplesPerPx / level.samplesPerBucket;
    ctx.strokeStyle = "#9ecbff";
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    for (let px = 0; px < W; px++) {
      const sec = pxToSec(px, vp);
      const sampleIdx = sec * vp.sampleRate;
      const bucket = Math.floor(sampleIdx / level.samplesPerBucket);
      if (bucket < 0 || bucket >= level.min.length) continue;
      const lo = level.min[bucket]!;
      const hi = level.max[bucket]!;
      ctx.moveTo(px + 0.5, mid - hi * (mid - 8));
      ctx.lineTo(px + 0.5, mid - lo * (mid - 8));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    void bucketsPerPx;
  }

  // (b) 拍/小節グリッド + 小節番号
  const lines = visibleGridLines(p.grid, vp);
  const barStep = adaptiveBarStep(barLenSecOf(p.grid), vp);
  let barLabels = 0;
  ctx.font = "9px monospace";
  for (const l of lines) {
    if (l.free) continue;
    ctx.strokeStyle = l.isBar ? barColor : beatColor;
    ctx.lineWidth = l.isBar ? 1.4 : 1;
    ctx.globalAlpha = l.isBar ? 0.5 : 0.3;
    ctx.beginPath();
    ctx.moveTo(l.px + 0.5, l.isBar ? 14 : 22);
    ctx.lineTo(l.px + 0.5, H);
    ctx.stroke();
    if (l.isBar && l.barNumber > 0 && l.barNumber % barStep === 0) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#68738a";
      ctx.fillText(String(l.barNumber), l.px + 3, 3);
      barLabels++;
    }
  }
  ctx.globalAlpha = 1;

  // (g) マーカーティック(beat/bar はグリッド線・silence はリージョンで描くのでティックから除外)
  const ticks = visibleMarkerTicks(p.markers.filter((m) => m.type !== "beat" && m.type !== "bar" && m.type !== "silence"), vp);
  for (const t of ticks) {
    ctx.strokeStyle = t.color;
    ctx.lineWidth = t.type === "custom" ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(t.px + 0.5, 10);
    ctx.lineTo(t.px + 0.5, H);
    ctx.stroke();
  }

  // (e) アンカー旗
  let drewAnchor = false;
  if (p.layout.anchorSec !== null) {
    const x = secToPx(p.layout.anchorSec, vp);
    ctx.fillStyle = anchorColor;
    ctx.beginPath();
    ctx.moveTo(x, 10); ctx.lineTo(x - 5, 2); ctx.lineTo(x + 5, 2); ctx.fill();
    ctx.fillRect(x - 0.75, 10, 1.5, H - 10);
    drewAnchor = true;
  }

  // (c) プレイヘッド
  const phx = secToPx(p.playheadSec, vp);
  let drewPlayhead = false;
  if (phx >= 0 && phx <= W) {
    ctx.fillStyle = playheadColor;
    ctx.fillRect(phx - 1, 0, 2, H);
    drewPlayhead = true;
  }

  return {
    gridLines: lines.filter((l) => !l.free).length,
    barLabels, markerTicks: ticks.length, silenceRects: silences.length,
    drewPlayhead, drewAnchor, drewFreeDim,
  };
}

function barLenSecOf(grid: GridBeat[]): number {
  const bars = grid.filter((g) => g.isBar && !g.free);
  return bars.length >= 2 ? bars[1]!.timeSec - bars[0]!.timeSec : 2;
}
```

- [ ] **Step 3: waveGeom テストが通ることを確認**

Run: `npx vitest run src/renderer/__tests__/waveGeom.test.ts`
Expected: 12 passed

- [ ] **Step 4: 失敗するテストを書く(paint + WaveCanvas)**

`app/src/renderer/__tests__/components/WaveCanvas.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";

import { deriveGrid } from "../../../shared/deriveGrid.js";
import type { AnalysisResult, Marker } from "../../../shared/types.js";
import { defaultEditState } from "../../../shared/validate.js";
import type { PlaybackEngine } from "../../audio/playback.js";
import { WaveCanvas } from "../../components/WaveCanvas.js";
import { paintWave, type Ctx2D, type WaveLayout, type Viewport } from "../../editor/waveGeom.js";
import { ViewStoreProvider } from "../../state/viewStore.js";

function recordingCtx(): Ctx2D & { calls: Record<string, number>; setTransform: () => void } {
  const calls: Record<string, number> = {};
  const bump = (k: string) => { calls[k] = (calls[k] ?? 0) + 1; };
  return {
    calls,
    save: () => bump("save"), restore: () => bump("restore"),
    beginPath: () => bump("beginPath"), moveTo: () => bump("moveTo"), lineTo: () => bump("lineTo"),
    stroke: () => bump("stroke"), fill: () => bump("fill"),
    fillRect: () => bump("fillRect"), clearRect: () => bump("clearRect"),
    fillText: () => bump("fillText"), setLineDash: () => bump("setLineDash"),
    setTransform: () => bump("setTransform"), // WaveCanvas が dpr スケールで呼ぶ
    strokeStyle: "", fillStyle: "", lineWidth: 1, font: "", globalAlpha: 1,
  };
}

const VP: Viewport = { scrollSec: 0, samplesPerPx: 441, sampleRate: 44100, widthPx: 1000 };
function grid() {
  const a: AnalysisResult = {
    durationSec: 12, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0,
    beats: Array.from({ length: 24 }, (_, i) => i * 0.5), downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [], hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
  };
  return deriveGrid(a, defaultEditState());
}

describe("paintWave(フェイク2Dコンテキスト)", () => {
  it("描いたグリッド線数が可視拍数に一致し、プレイヘッドを描く", () => {
    const g = grid();
    const layout: WaveLayout = { viewport: VP, heightPx: 200, anchorSec: null, sectionBoundaries: [], markers: [] };
    const ctx = recordingCtx();
    const stats = paintWave(ctx, { layout, peaks: null, grid: g, markers: [], playheadSec: 1 });
    // 0..10s 表示に 0.5s間隔 → 21拍
    expect(stats.gridLines).toBe(21);
    expect(stats.drewPlayhead).toBe(true);
    expect(ctx.calls["stroke"]).toBeGreaterThan(0);
  });

  it("静寂リージョンと手動マーカーを描画件数に反映", () => {
    const markers: Marker[] = [
      { id: "sil-0-in", sourceId: "mix", timeSec: 2, type: "silence", label: "静寂IN", color: "#6b7686", source: "auto", meta: { durationSec: 1 } },
      { id: "custom-1", sourceId: "mix", timeSec: 3, type: "custom", label: "M", color: "#ffd166", source: "user" },
    ];
    const layout: WaveLayout = { viewport: VP, heightPx: 200, anchorSec: null, sectionBoundaries: [], markers: [] };
    const stats = paintWave(recordingCtx(), { layout, peaks: null, grid: grid(), markers, playheadSec: 1 });
    expect(stats.silenceRects).toBe(1);
    expect(stats.markerTicks).toBe(1); // beat/bar 除外、custom のみ
  });
});

describe("WaveCanvas マウント", () => {
  it("canvas を描画し 2D コンテキストを取得する", () => {
    const getContext = vi.fn(() => recordingCtx());
    // jsdom は getContext=null なのでスタブ差し替え
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = getContext as unknown as typeof orig;
    const pb: PlaybackEngine = {
      load: vi.fn(async () => {}), play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(),
      currentTime: vi.fn(() => 0), isPlaying: vi.fn(() => false), durationSec: vi.fn(() => 12),
      setLoop: vi.fn(), setMetronome: vi.fn(), updateGrid: vi.fn(), dispose: vi.fn(),
    };
    const { container } = render(
      <ViewStoreProvider>
        <WaveCanvas
          peaks={null} grid={grid()} markers={[]} anchorSec={null} playback={pb}
          sampleRate={44100} onSelectMarker={vi.fn()} onAnchorDrag={vi.fn()}
        />
      </ViewStoreProvider>,
    );
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(getContext).toHaveBeenCalled();
    HTMLCanvasElement.prototype.getContext = orig;
  });
});
```

- [ ] **Step 5: テスト失敗を確認 → WaveCanvas.tsx 実装**

Run: `npx vitest run src/renderer/__tests__/components/WaveCanvas.test.tsx`
Expected: FAIL(paint 2件はモジュール未作成で collect エラー、WaveCanvas 未実装)

`app/src/renderer/components/WaveCanvas.tsx`:

```tsx
/** メイン波形(スペック §7 ⑤): ピーク/グリッド/プレイヘッド/静寂/アンカー旗/減光/マーカー。
 *  ロジックは waveGeom に寄せ、ここは canvas サイズ管理・rAF・ポインタ操作の薄い層。 */
import React, { useCallback, useEffect, useRef } from "react";

import type { GridBeat } from "../../shared/deriveGrid.js";
import type { Marker } from "../../shared/types.js";
import type { PlaybackEngine } from "../audio/playback.js";
import { snapSec } from "../editor/snap.js";
import { useViewStore } from "../state/viewStore.js";
import {
  hitTest, paintWave, pxToSec, zoomAt,
  type Ctx2D, type Viewport, type WaveLayout,
} from "../editor/waveGeom.js";

export interface WaveCanvasProps {
  peaks: import("../editor/peaks.js").PeakSet | null;
  grid: GridBeat[];
  markers: Marker[];
  anchorSec: number | null;
  playback: PlaybackEngine;
  sampleRate: number;
  onSelectMarker: (id: string) => void;
  onAnchorDrag: (sec: number) => void;
}

export function WaveCanvas(props: WaveCanvasProps): React.JSX.Element {
  const { playback, grid, markers, anchorSec, sampleRate } = props;
  const { view, dispatch } = useViewStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingAnchor = useRef(false);

  const viewport = useCallback((widthPx: number): Viewport => ({
    scrollSec: view.scrollSec, samplesPerPx: view.zoomSamplesPerPx, sampleRate, widthPx,
  }), [view.scrollSec, view.zoomSamplesPerPx, sampleRate]);

  const layout = useCallback((widthPx: number, heightPx: number): WaveLayout => ({
    viewport: viewport(widthPx), heightPx, anchorSec,
    sectionBoundaries: markers
      .filter((m) => m.type === "section" && /^sec-o\d+$/.test(m.id))
      .map((m) => ({ index: parseInt(m.id.slice(5), 10), id: m.id, sec: m.timeSec })),
    markers: markers.map((m) => ({ id: m.id, sec: m.timeSec, type: m.type })),
  }), [viewport, anchorSec, markers]);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const raw = cv.getContext("2d");
    if (!raw) return;
    const ctx = raw as unknown as Ctx2D & { setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintWave(ctx, {
      layout: layout(w, h), peaks: props.peaks, grid, markers, playheadSec: playback.currentTime(),
    });
  }, [layout, props.peaks, grid, markers, playback]);

  // 表示状態・データ変更時に再描画
  useEffect(() => { draw(); }, [draw]);

  // 再生中のみ rAF でプレイヘッド更新(停止中は静止)
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (playback.isPlaying()) { draw(); raf = requestAnimationFrame(loop); }
    };
    if (playback.isPlaying()) raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw, playback]);

  function localPos(e: React.PointerEvent): { x: number; y: number; w: number } {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width };
  }

  function onWheel(e: React.WheelEvent): void {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const anchorPx = e.clientX - rect.left;
    const vp = viewport(rect.width);
    if (e.ctrlKey || e.metaKey) {
      // 横スクロール
      const dSec = (e.deltaY * vp.samplesPerPx) / vp.sampleRate;
      dispatch({ type: "SET_VIEW", scrollSec: Math.max(0, vp.scrollSec + dSec) });
    } else {
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const z = zoomAt(vp, factor, anchorPx);
      dispatch({ type: "SET_VIEW", scrollSec: Math.max(0, z.scrollSec), zoomSamplesPerPx: z.samplesPerPx });
    }
  }

  const dragState = useRef<{ startX: number; startScroll: number } | null>(null);

  function onPointerDown(e: React.PointerEvent): void {
    const { x, y, w } = localPos(e);
    const cv = canvasRef.current!;
    const hit = hitTest(x, y, layout(w, cv.getBoundingClientRect().height));
    cv.setPointerCapture(e.pointerId);
    if (hit.kind === "anchor") { draggingAnchor.current = true; return; }
    if (hit.kind === "marker") { props.onSelectMarker(hit.id); return; }
    if (hit.kind === "sectionBoundary") {
      const b = layout(w, 0).sectionBoundaries.find((s) => s.index === hit.index);
      if (b) props.onSelectMarker(b.id);
      return;
    }
    dragState.current = { startX: x, startScroll: view.scrollSec };
  }

  function onPointerMove(e: React.PointerEvent): void {
    const { x, w } = localPos(e);
    const vp = viewport(w);
    if (draggingAnchor.current) {
      const raw = pxToSec(x, vp);
      const snap = e.ctrlKey || e.metaKey ? raw : snapSec(raw, view.snapMode, { fps: { num: 30, den: 1 }, grid });
      props.onAnchorDrag(snap);
      return;
    }
    if (dragState.current) {
      const dSec = ((dragState.current.startX - x) * vp.samplesPerPx) / vp.sampleRate;
      dispatch({ type: "SET_VIEW", scrollSec: Math.max(0, dragState.current.startScroll + dSec) });
    }
  }

  function onPointerUp(e: React.PointerEvent): void {
    draggingAnchor.current = false;
    dragState.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: "crosshair" }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
```

> スナップの `fps` は本コンポーネントでは秒/拍/小節のみ使うため固定値でよい(frame スナップは T8 のグリッドバーが `fps` を渡す構成に統合する — T12 で `fps` を prop 化)。

- [ ] **Step 6: 全テスト + typecheck で検証**

Run: `npx vitest run src/renderer/__tests__/waveGeom.test.ts src/renderer/__tests__/components/WaveCanvas.test.tsx && npx tsc --noEmit`
Expected: waveGeom 12 + paint 2 + WaveCanvas 1 = 15 passed、typecheck OK

- [ ] **Step 7: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/renderer/editor/waveGeom.ts app/src/renderer/components/WaveCanvas.tsx \
  app/src/renderer/__tests__/waveGeom.test.ts app/src/renderer/__tests__/components/WaveCanvas.test.tsx
git commit -m "feat(app): メイン波形Canvas(座標系/ズーム/ヒットテスト/描画)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SR5fj8BNeN6TUFgoj4zhm6"
```

---

### Task 6: オーバービュー+セクション帯

**Files:**
- Create: `app/src/renderer/editor/overviewGeom.ts`(全体波形の座標変換 — 純ロジック)
- Create: `app/src/renderer/editor/sectionGeom.ts`(セクション境界ドラッグの数学 — 純ロジック)
- Create: `app/src/renderer/components/Overview.tsx`
- Create: `app/src/renderer/components/SectionBand.tsx`
- Test: `app/src/renderer/__tests__/overviewGeom.test.ts`
- Test: `app/src/renderer/__tests__/sectionGeom.test.ts`
- Test: `app/src/renderer/__tests__/components/SectionBand.test.tsx`
- Test: `app/src/renderer/__tests__/components/Overview.test.tsx`

**Interfaces:**
- Consumes: `editor/waveGeom.ts`(Viewport/pxToSec)、`editor/peaks.ts`(PeakSet/pickLevel)、`editor/snap.ts`(SnapMode)、`shared/types.ts`(SectionEdit/Action は store)、`strings.ts`
- Produces:
  - overviewGeom: `overviewXToSec` / `overviewSecToX` / `overviewWindowRect(durationSec, vp, widthPx)`
  - sectionGeom: `sectionIndexFromId(id): number|null`(`sec-o{i}` のみ)、`clampBoundarySec` / `resolveBoundaryDrag`
  - `Overview` props: 全体波形+セクション色帯+表示窓ドラッグ+クリックジャンプ(コールバック `onScrubTo(sec)`)
  - `SectionBand` props: セクション帯。境界ドラッグ→`onMoveBoundary(index, sec)`、ダブルクリック→`onRename(index, label)`、削除→`onDelete(id)`、再生位置に境界追加→`onAddAtPlayhead()`

> **契約補正/仕様確定**: セクション色は `deriveMarkers` が既に `Marker.color` に埋めている(SECTION_COLORS)ため、Overview/SectionBand は marker.color を直接使う。境界の**移動/リネーム**は元セクション(`sec-o{i}`)のみ対応(`SectionEdit.move/rename` は元添字を要求。追加セクション `sec-a*` の移動/改名は現行 EditState では表現できず Phase2)。**削除**はタスク指示どおり `MARKER_DELETED sec-id`(=そのマーカーを非表示化)を用いる — これは「境界を消して前区間に統合」ではなく「そのセクションマーカーを隠す」挙動である点に注意(真のマージが必要なら `SectionEdit.delete` を使う設計に将来切替可)。実 store アクションへの接続(`SECTION_EDIT_ADDED`/`MARKER_DELETED`/`CUSTOM_MARKER_ADDED`)は本コンポーネントを prop コールバックで薄く保ち、EditorScreen(T12)で配線する。

- [ ] **Step 1: 失敗するテストを書く(overviewGeom / sectionGeom)**

`app/src/renderer/__tests__/overviewGeom.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Viewport } from "../editor/waveGeom.js";
import { overviewSecToX, overviewWindowRect, overviewXToSec } from "../editor/overviewGeom.js";

describe("overviewGeom", () => {
  it("overviewXToSec: 全幅を尺に線形マップ", () => {
    expect(overviewXToSec(0, 1000, 200)).toBeCloseTo(0, 6);
    expect(overviewXToSec(500, 1000, 200)).toBeCloseTo(100, 6);
    expect(overviewXToSec(1000, 1000, 200)).toBeCloseTo(200, 6);
  });
  it("overviewXToSec: 尺0では0", () => {
    expect(overviewXToSec(500, 1000, 0)).toBe(0);
  });
  it("overviewSecToX は逆変換", () => {
    expect(overviewSecToX(100, 1000, 200)).toBeCloseTo(500, 6);
  });
  it("overviewWindowRect: 表示窓の x/w", () => {
    // vp: scroll=50, 1000px が 20s(0.02s/px)を表示 → 窓 [50,70]s
    const vp: Viewport = { scrollSec: 50, samplesPerPx: 882, sampleRate: 44100, widthPx: 1000 };
    const r = overviewWindowRect(200, vp, 1000);
    expect(r.x).toBeCloseTo(250, 0);  // 50/200*1000
    expect(r.w).toBeCloseTo(100, 0);  // 20/200*1000
  });
  it("overviewWindowRect: 尺0でも壊れない", () => {
    const vp: Viewport = { scrollSec: 0, samplesPerPx: 882, sampleRate: 44100, widthPx: 1000 };
    expect(overviewWindowRect(0, vp, 1000)).toEqual({ x: 0, w: 0 });
  });
});
```

`app/src/renderer/__tests__/sectionGeom.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { clampBoundarySec, resolveBoundaryDrag, sectionIndexFromId } from "../editor/sectionGeom.js";
import type { Viewport } from "../editor/waveGeom.js";

describe("sectionIndexFromId", () => {
  it("sec-o{i} は元添字、sec-a{n} は null", () => {
    expect(sectionIndexFromId("sec-o3")).toBe(3);
    expect(sectionIndexFromId("sec-o0")).toBe(0);
    expect(sectionIndexFromId("sec-a0")).toBeNull();
    expect(sectionIndexFromId("bar-1")).toBeNull();
  });
});

describe("clampBoundarySec", () => {
  it("前後の隣接境界から minGap を空けてクランプ", () => {
    expect(clampBoundarySec(5, 2, 10, 0.5)).toBe(5);
    expect(clampBoundarySec(2.1, 2, 10, 0.5)).toBe(2.5); // 前境界+minGap
    expect(clampBoundarySec(9.9, 2, 10, 0.5)).toBe(9.5); // 次境界-minGap
  });
});

describe("resolveBoundaryDrag", () => {
  const vp: Viewport = { scrollSec: 0, samplesPerPx: 441, sampleRate: 44100, widthPx: 1000 }; // 0.01s/px
  it("px→sec→snap→clamp の合成", () => {
    const snap = (s: number) => Math.round(s * 2) / 2; // 0.5s刻み
    // px=630 → 6.3s → snap 6.5s → 前2/後10でクランプ内 → 6.5
    expect(resolveBoundaryDrag(630, vp, 2, 10, 0.5, snap)).toBeCloseTo(6.5, 6);
    // px=120 → 1.2s → snap 1.0s → 前2+0.5=2.5でクランプ → 2.5
    expect(resolveBoundaryDrag(120, vp, 2, 10, 0.5, snap)).toBeCloseTo(2.5, 6);
  });
});
```

- [ ] **Step 2: テスト失敗を確認 → 純ロジック実装**

Run: `npx vitest run src/renderer/__tests__/overviewGeom.test.ts src/renderer/__tests__/sectionGeom.test.ts`
Expected: FAIL — `Cannot find module '../editor/overviewGeom.js'`

`app/src/renderer/editor/overviewGeom.ts`:

```ts
/** オーバービュー(曲全体)の座標変換。表示窓の矩形算出(スペック §7 ③)。 */
import { visibleRange, type Viewport } from "./waveGeom.js";

export function overviewXToSec(x: number, widthPx: number, durationSec: number): number {
  return durationSec > 0 && widthPx > 0 ? (x / widthPx) * durationSec : 0;
}
export function overviewSecToX(sec: number, widthPx: number, durationSec: number): number {
  return durationSec > 0 ? (sec / durationSec) * widthPx : 0;
}
export function overviewWindowRect(
  durationSec: number, vp: Viewport, widthPx: number,
): { x: number; w: number } {
  if (durationSec <= 0) return { x: 0, w: 0 };
  const { fromSec, toSec } = visibleRange(vp);
  const x = overviewSecToX(fromSec, widthPx, durationSec);
  const w = overviewSecToX(toSec, widthPx, durationSec) - x;
  return { x, w };
}
```

`app/src/renderer/editor/sectionGeom.ts`:

```ts
/** セクション境界ドラッグの数学(スペック §7 ④)。純ロジック。 */
import { pxToSec, type Viewport } from "./waveGeom.js";

/** 元セクション(sec-o{i})の添字。追加セクション(sec-a*)・非セクションは null。 */
export function sectionIndexFromId(id: string): number | null {
  const m = id.match(/^sec-o(\d+)$/);
  return m ? parseInt(m[1]!, 10) : null;
}

/** 前後の隣接境界から minGap を空けた範囲にクランプ。 */
export function clampBoundarySec(sec: number, prevSec: number, nextSec: number, minGap: number): number {
  return Math.min(Math.max(sec, prevSec + minGap), nextSec - minGap);
}

/** px → 秒 → スナップ → クランプ の合成(⌘バイパスは snap 側で恒等を渡す)。 */
export function resolveBoundaryDrag(
  px: number, vp: Viewport, prevSec: number, nextSec: number, minGap: number,
  snap: (sec: number) => number,
): number {
  return clampBoundarySec(snap(pxToSec(px, vp)), prevSec, nextSec, minGap);
}
```

- [ ] **Step 3: 純ロジックテストが通ることを確認**

Run: `npx vitest run src/renderer/__tests__/overviewGeom.test.ts src/renderer/__tests__/sectionGeom.test.ts`
Expected: overviewGeom 5 + sectionGeom 3 = 8 passed

- [ ] **Step 4: 失敗するテストを書く(SectionBand / Overview RTL)**

`app/src/renderer/__tests__/components/SectionBand.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";

import { SectionBand, type SectionView } from "../../components/SectionBand.js";
import type { Viewport } from "../../editor/waveGeom.js";
import { STRINGS } from "../../strings.js";

const VP: Viewport = { scrollSec: 0, samplesPerPx: 441, sampleRate: 44100, widthPx: 1000 };
const SECTIONS: SectionView[] = [
  { id: "sec-o0", startSec: 0, durationSec: 4, label: "イントロ", color: "#5b7fd4" },
  { id: "sec-o1", startSec: 4, durationSec: 4, label: "Aメロ", color: "#38a3a5" },
];

function renderBand(cb: Partial<Record<"onMoveBoundary" | "onRename" | "onDelete" | "onAddAtPlayhead", ReturnType<typeof vi.fn>>> = {}) {
  const props = {
    sections: SECTIONS, viewport: VP, barIntervalSec: 2, playheadSec: 5,
    snap: (s: number) => s,
    onMoveBoundary: cb.onMoveBoundary ?? vi.fn(),
    onRename: cb.onRename ?? vi.fn(),
    onDelete: cb.onDelete ?? vi.fn(),
    onAddAtPlayhead: cb.onAddAtPlayhead ?? vi.fn(),
  };
  return { ...render(<SectionBand {...props} />), props };
}

describe("SectionBand", () => {
  it("ダブルクリックでインライン入力→Enterで onRename(index,label)", () => {
    const onRename = vi.fn();
    renderBand({ onRename });
    fireEvent.doubleClick(screen.getByText("Aメロ"));
    const input = screen.getByDisplayValue("Aメロ");
    fireEvent.change(input, { target: { value: "サビ" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith(1, "サビ");
  });

  it("削除ボタンで onDelete(sec-id)", () => {
    const onDelete = vi.fn();
    renderBand({ onDelete });
    // 各セクションの削除ボタン(title=削除)。2つ目(Aメロ)を押す
    const dels = screen.getAllByTitle(STRINGS.section.delete);
    fireEvent.click(dels[1]!);
    expect(onDelete).toHaveBeenCalledWith("sec-o1");
  });

  it("再生位置に境界追加ボタンで onAddAtPlayhead", () => {
    const onAddAtPlayhead = vi.fn();
    renderBand({ onAddAtPlayhead });
    fireEvent.click(screen.getByText(STRINGS.section.addAtPlayhead));
    expect(onAddAtPlayhead).toHaveBeenCalled();
  });
});
```

`app/src/renderer/__tests__/components/Overview.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";

import { Overview } from "../../components/Overview.js";
import type { Viewport } from "../../editor/waveGeom.js";

describe("Overview マウント", () => {
  it("canvas を描画し 2D コンテキストを取得する", () => {
    const getContext = vi.fn(() => ({
      clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(),
      strokeStyle: "", fillStyle: "", lineWidth: 1, globalAlpha: 1,
    }));
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = getContext as unknown as typeof orig;
    const vp: Viewport = { scrollSec: 0, samplesPerPx: 441, sampleRate: 44100, widthPx: 1000 };
    const { container } = render(
      <Overview
        peaks={null} sections={[]} durationSec={210} viewport={vp}
        playheadSec={0} onScrubTo={vi.fn()}
      />,
    );
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(getContext).toHaveBeenCalled();
    HTMLCanvasElement.prototype.getContext = orig;
  });
});
```

- [ ] **Step 5: テスト失敗を確認 → SectionBand.tsx / Overview.tsx 実装**

Run: `npx vitest run src/renderer/__tests__/components/SectionBand.test.tsx`
Expected: FAIL — `Cannot find module '../../components/SectionBand.js'`

`app/src/renderer/components/SectionBand.tsx`:

```tsx
/** セクション帯(スペック §7 ④): 色帯・小節数・境界ドラッグ・ダブルクリックリネーム・削除・境界追加。
 *  モックの sectionlane 相当。実 store 接続は EditorScreen(T12)がコールバックを配線する。 */
import React, { useState } from "react";

import { resolveBoundaryDrag, sectionIndexFromId } from "../editor/sectionGeom.js";
import { secToPx, type Viewport } from "../editor/waveGeom.js";
import { STRINGS } from "../strings.js";

const S = STRINGS.section;

export interface SectionView {
  id: string;
  startSec: number;
  durationSec: number;
  label: string;
  color: string;
}

export interface SectionBandProps {
  sections: SectionView[];
  viewport: Viewport;
  barIntervalSec: number;
  playheadSec: number;
  snap: (sec: number) => number; // ⌘バイパスは呼び出し側で恒等を渡す
  onMoveBoundary: (index: number, sec: number) => void; // index=元セクション添字
  onRename: (index: number, label: string) => void;
  onDelete: (id: string) => void;
  onAddAtPlayhead: () => void;
}

const MIN_GAP = 0.1;

export function SectionBand(props: SectionBandProps): React.JSX.Element {
  const { sections, viewport: vp } = props;
  const [editing, setEditing] = useState<{ index: number; value: string } | null>(null);

  function commitRename(): void {
    if (editing) { props.onRename(editing.index, editing.value); setEditing(null); }
  }

  /** i番目セクションの右ハンドルドラッグ = i+1番目セクションの startSec を動かす。 */
  function handleDrag(i: number, e: React.PointerEvent): void {
    const next = sections[i + 1];
    if (!next) return;
    const targetIndex = sectionIndexFromId(next.id);
    if (targetIndex === null) return; // 追加セクションは移動不可(Phase2)
    const el = (e.currentTarget as HTMLElement).closest("[data-sectionband]") as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    const prevSec = sections[i]!.startSec;
    const nextSec = sections[i + 2]?.startSec ?? next.startSec + next.durationSec;
    const move = (ev: PointerEvent) => {
      const x = rect ? ev.clientX - rect.left : ev.clientX;
      const sec = resolveBoundaryDrag(x, vp, prevSec, nextSec, MIN_GAP, ev.ctrlKey || ev.metaKey ? (s) => s : props.snap);
      props.onMoveBoundary(targetIndex, sec);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div data-sectionband style={{ position: "relative", height: 26, margin: "6px 14px 0" }}>
      {sections.map((s, i) => {
        const left = Math.max(0, secToPx(s.startSec, vp));
        const right = Math.min(vp.widthPx, secToPx(s.startSec + s.durationSec, vp));
        const bars = Math.round(s.durationSec / props.barIntervalSec);
        if (right <= left) return null;
        return (
          <div
            key={s.id}
            style={{
              position: "absolute", top: 0, height: "100%", left, width: right - left,
              background: s.color, borderRadius: "5px 5px 0 0", display: "flex", alignItems: "center",
              padding: "0 8px", fontWeight: 700, fontSize: 11, color: "#fff", overflow: "hidden",
              whiteSpace: "nowrap", cursor: "grab",
            }}
            title={S.editHint}
          >
            {editing?.index === i ? (
              <input
                autoFocus
                value={editing.value}
                onChange={(e) => setEditing({ index: i, value: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(null); }}
                onBlur={commitRename}
                style={{ font: "inherit", width: "100%", background: "rgba(0,0,0,.3)", color: "#fff", border: "none" }}
              />
            ) : (
              <span onDoubleClick={() => setEditing({ index: i, value: s.label })}>
                {s.label}<small style={{ fontWeight: 400, opacity: 0.8, marginLeft: 6 }}>{bars}{S.barsSuffix}</small>
              </span>
            )}
            <button
              title={S.delete}
              onClick={() => props.onDelete(s.id)}
              style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#fff", cursor: "pointer", fontSize: 11 }}
            >×</button>
            {i < sections.length - 1 && (
              <span
                onPointerDown={(e) => handleDrag(i, e)}
                style={{
                  position: "absolute", right: -1, top: 0, bottom: 0, width: 7, cursor: "col-resize",
                  background: "linear-gradient(90deg,transparent,rgba(255,255,255,.55))", borderRadius: "0 4px 0 0",
                }}
              />
            )}
          </div>
        );
      })}
      <button
        onClick={props.onAddAtPlayhead}
        style={{
          position: "absolute", right: 0, top: -2, fontSize: 10, background: "#1f242d",
          color: "#e8ebf0", border: "1px solid #262c36", borderRadius: 6, padding: "2px 6px", cursor: "pointer",
        }}
      >{S.addAtPlayhead}</button>
    </div>
  );
}
```

`app/src/renderer/components/Overview.tsx`:

```tsx
/** オーバービュー(スペック §7 ③): 全体波形(最粗レベル)・セクション色帯・表示窓ドラッグ・クリックジャンプ。
 *  モックの overview 相当。 */
import React, { useCallback, useEffect, useRef } from "react";

import { pickLevel, type PeakSet } from "../editor/peaks.js";
import { overviewSecToX, overviewWindowRect, overviewXToSec } from "../editor/overviewGeom.js";
import type { Viewport } from "../editor/waveGeom.js";

export interface OverviewSection { startSec: number; durationSec: number; color: string }

export interface OverviewProps {
  peaks: PeakSet | null;
  sections: OverviewSection[];
  durationSec: number;
  viewport: Viewport;
  playheadSec: number;
  onScrubTo: (sec: number) => void; // クリック/窓ドラッグ → 表示範囲移動+シーク(呼び出し側で配線)
}

export function Overview(props: OverviewProps): React.JSX.Element {
  const { peaks, sections, durationSec, viewport, playheadSec } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    const W = Math.max(1, rect.width);
    const H = Math.max(1, rect.height);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d") as (CanvasRenderingContext2D & { strokeRect: (x: number, y: number, w: number, h: number) => void }) | null;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // セクション色帯(背景 + 上部4pxの濃色)
    for (const s of sections) {
      const x = overviewSecToX(s.startSec, W, durationSec);
      const w = overviewSecToX(s.durationSec, W, durationSec);
      ctx.globalAlpha = 0.15; ctx.fillStyle = s.color; ctx.fillRect(x, 0, w, H);
      ctx.globalAlpha = 1; ctx.fillStyle = s.color; ctx.fillRect(x, 0, w, 4);
    }

    // 全体波形(最粗レベル)
    if (peaks && peaks.length > 0) {
      const level = peaks.levels[peaks.levels.length - 1] ?? pickLevel(peaks, Infinity);
      ctx.strokeStyle = "#aeb8c9"; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.beginPath();
      for (let px = 0; px < W; px++) {
        const sec = overviewXToSec(px, W, durationSec);
        const bucket = Math.floor((sec * peaks.sampleRate) / level.samplesPerBucket);
        if (bucket < 0 || bucket >= level.max.length) continue;
        const a = Math.max(Math.abs(level.min[bucket]!), Math.abs(level.max[bucket]!)) * (H / 2 - 6);
        ctx.moveTo(px + 0.5, H / 2 - a); ctx.lineTo(px + 0.5, H / 2 + a);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }

    // 表示窓
    const win = overviewWindowRect(durationSec, viewport, W);
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5;
    ctx.strokeRect(win.x + 0.5, 1, win.w, H - 2);

    // 再生ヘッド
    const phx = overviewSecToX(playheadSec, W, durationSec);
    ctx.fillStyle = "#ff4d6b"; ctx.fillRect(phx - 0.75, 0, 1.5, H);
  }, [peaks, sections, durationSec, viewport, playheadSec]);

  useEffect(() => { draw(); }, [draw]);

  function onPointer(e: React.PointerEvent): void {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const sec = overviewXToSec(e.clientX - rect.left, rect.width, durationSec);
    props.onScrubTo(sec);
  }

  return (
    <div style={{ position: "relative", background: "#14171c", borderBottom: "1px solid #262c36", padding: "6px 14px 4px" }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointer}
        style={{ width: "100%", height: 44, display: "block", borderRadius: 4, cursor: "pointer" }}
      />
    </div>
  );
}
```

- [ ] **Step 6: 全テスト + typecheck + ビルドで検証**

Run:

```bash
npx vitest run 2>&1 | tail -4
npx tsc --noEmit && npx tsc -p tsconfig.node.json --noEmit && echo "typecheck OK"
npx electron-vite build 2>&1 | tail -3 || echo "build skip(electronバイナリ取得不可の場合 — ③cのCIで担保)"
```

Expected: SectionBand 3 + Overview 1 = 4 passed(Task6 新規は純ロジック8+RTL4=12)、全体 **293 passed**(214 + T1:11 + T2:8 + T3:22 + T4:11 + T5:15 + T6:12)、typecheck OK

- [ ] **Step 7: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/renderer/editor/overviewGeom.ts app/src/renderer/editor/sectionGeom.ts \
  app/src/renderer/components/Overview.tsx app/src/renderer/components/SectionBand.tsx \
  app/src/renderer/__tests__/overviewGeom.test.ts app/src/renderer/__tests__/sectionGeom.test.ts \
  app/src/renderer/__tests__/components/SectionBand.test.tsx app/src/renderer/__tests__/components/Overview.test.tsx
git commit -m "feat(app): オーバービュー(全体波形+表示窓)+セクション帯(境界/リネーム/削除)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SR5fj8BNeN6TUFgoj4zhm6"
```

---

> **契約差分メモ(実コードを正とし、スケルトンのインターフェース契約・タスク指示から乖離する点をここに集約)**
> 実装者はまずここを読むこと。以下は「読んだ実コード」に合わせた確定事項で、各タスク本文もこれに従う。
>
> 1. **EditState のフィールド名は実コード優先**: スペック §6 の `timeSig`/`sectionOverrides` ではなく、`app/src/shared/types.ts` の `beatsPerBar: number`(4/4→4, 3/4→3, 6/8→6)/`sectionEdits` を使う。
> 2. **`bpmOverride?: number`(optional・undefined でクリア)**。契約ヒントの `number|null` ではない。`deriveGrid` は `undefined || !finite || <=0` を「上書きなし」とみなす。クリアは `EDIT_APPLIED {bpmOverride: undefined}`。
> 3. **`gridAnchor?: { timeSec: number; freeBefore: boolean }`**。契約ヒントの `number|null` ではない。設定=`{gridAnchor:{timeSec, freeBefore}}`、解除=`{gridAnchor: undefined}`。
> 4. **`RoundingMode`**(`"nearest"|"floor"`)が正。契約の `Rounding` は誤記。
> 5. **`ExportTarget` = `TargetKey`**(`app/src/shared/naming.ts`、11キー: json/csv/midi/aejsx/premiere/resolve/blender/wavcues/reaper/nuendo/audacity)。
> 6. **naming.ts に衝突回避(dedup)ロジックは無い**。`buildFileName` は純粋な名前生成のみ。バッチ内のファイル名衝突回避は **T10 の exportWriter が担保**(`-2`,`-3` 付与)。
> 7. **`runExport("wavcues", …)` は `ExportError` を投げる**。WAV キューは `embedWavCues(wavBytes, markers, ctx)` を直接呼ぶ(`exporters/wavCues.ts`)。
> 8. **エクスポータはエンベロープを内部で fps 再サンプルする**(`aejsx.ts` が `resampleEnvelopeToFps` を内部呼び出し)。exportWriter は生の `analysis.envelopes`(100Hz)をそのまま `ctx.envelopes` に渡す。
> 9. **`ExportRequest` に `includeEnvelopes: boolean` を追加**(契約に無いが、モックの「エンベロープ」チェックは MarkerType ではないため独立フラグが必要。T10)。
> 10. **`OpenProjectOutcome` から `analyzed` を削除**(.bmk が per-source の analysis を保持 → 再解析不要。契約の `analyzed: AnalyzedProject|null` は冗長)。代わりに `path` を追加。**`ProjectFileState` から `playbackWavPath` を削除**(T11、mediaPath から再抽出)ため、`PROJECT_LOADED` は `playbackWavPath` を別引数で受け取る。
> 11. **テスト基盤は A の T1 が構築済み**(当初メモの「vitest.config が .tsx 未対応→T7で拡張」は**解消済みで無効**): `app/package.json` に `@testing-library/react ^16`(React 19 互換)/`user-event ^14`/`jsdom ^29` が入り、`app/vitest.config.ts` は **`globals: true` + `include: ["src/**/__tests__/**/*.test.{ts,tsx}"]`** に設定済み。コンポーネントテストは各ファイル冒頭に `// @vitest-environment jsdom` を付ける。**T7 以降で vitest.config を上書きしない**(`globals: true` を落とすと RTL 自動 cleanup が壊れる)。
> 12. **React は 19**(package.json)。プランヘッダの「React 18」は誤り。返り値型は `React.JSX.Element`(既存 App.tsx に準拠)。
> 13. **文言**: §7 の strings.ts 分離方針に沿い、各コンポーネント先頭に co-located な `const S = {…}` 定数として置く(定数分離は満たす)。T1 の strings.ts へ集約する場合はそこへ移設可能。
> 14. **store の網羅性ガード**: `store.ts` は2つの switch に `never` 網羅性チェックを持つ。アクション追加時は「上段 switch のフォールスルー break 一覧」と「editor 専用 switch のケース」の両方を更新する(T9/T11)。本メモは T1 が `MARKER_SELECTED`/`ANALYZE_FAILED`/`selectedMarkerId`/`error` フェーズを追加済みの store を土台とする。

---

### Task 7: ヒットレーン+感度スライダー

**Files:**
- Create: `app/src/renderer/editor/hitLaneModel.ts`(純ロジック: 表示ティックのフィルタ/座標)
- Create: `app/src/renderer/components/HitLanes.tsx`
- Test: `app/src/renderer/__tests__/hitLaneModel.test.ts`、`app/src/renderer/__tests__/HitLanes.test.tsx`
- (`app/vitest.config.ts` は **T1 で設定済み** — 本タスクでは変更しない。検証のみ)

**Interfaces:**
- Consumes(既存): `AnalysisResult.hits`(`HitInfo[] {timeSec, band, strength}`)、`EditState.hitThreshold {low,mid,high}`、`HIT_COLORS`(`shared/deriveMarkers.ts`)、`Band`(`shared/types.ts`)。
- Consumes(T5 提供): `Viewport`、`secToPx(sec,vp)`、`visibleRange(vp)`(`editor/waveGeom.ts`)。**hitLaneModel はこれらに依存しない**よう `fromSec/toSec` と `toPx` を引数で受ける(テスト独立性のため)。
- Consumes(T1 提供): `Action`(`EDIT_APPLIED`、`MARKER_SELECTED`)、`state.selectedMarkerId`。
- Produces: `HitLanes`(帯域別レーン+帯域別しきい値スライダー)。しきい値未満のヒットは **描画しない**(deriveMarkers の `strength < threshold` フィルタと同一規則 — faint 表示にはしない)。削除済みヒット(`deletedMarkerIds`)も描画しない(復元は T9 のテーブル)。
- 設計判断(モックとの差分・注記): モックは単一 40px レーン+単一「感度」スライダーだが、`EditState.hitThreshold` は帯域別。データモデルとタスク要件に合わせ **低/中/高の3レーン+帯域別スライダー**にする(色・ダイヤ形ティック・右上コントロールというモックの視覚言語は踏襲)。ティックは Canvas ではなく絶対配置 DOM(クリック→選択とRTLテストが容易。ウィンドウ内ヒット数は小さくDOMで十分)。

- [ ] **Step 1: vitest.config は T1 設定済み — 検証のみ(変更しない)**

`app/vitest.config.ts` は **A の T1 で既に** 次のとおり設定済みで、本タスクでは触らない(上書きすると T1 の `globals: true` を落として @testing-library の自動 cleanup が壊れ「Found multiple elements」で落ちるため、上書き厳禁):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,                                          // ← T1 で追加。RTL 自動 cleanup に必須(落とさない)
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],       // ← T1 で .tsx 収集済み
  },
});
```

検証: `grep -q "globals: true" app/vitest.config.ts && grep -q "tsx" app/vitest.config.ts` が両方 true であること。(B 当初メモの「vitest.config が .tsx 未対応→T7で拡張」は **T1 で解消済み**のため無効。)

- [ ] **Step 2: 失敗するテストを書く**

`app/src/renderer/__tests__/hitLaneModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { visibleHitTicks } from "../editor/hitLaneModel.js";
import type { HitInfo } from "../../shared/types.js";

const hits: HitInfo[] = [
  { timeSec: 1.0, band: "low", strength: 0.9 },
  { timeSec: 1.5, band: "low", strength: 0.2 },   // しきい値未満で除外
  { timeSec: 2.0, band: "mid", strength: 0.8 },   // band違いで除外(low問い合わせ時)
  { timeSec: 9.0, band: "low", strength: 0.95 },  // 範囲外で除外
];
const toPx = (s: number) => s * 10; // T5非依存の決定的マッピング

describe("visibleHitTicks", () => {
  it("band・しきい値・表示範囲でフィルタし、元配列添字を保持する", () => {
    const ticks = visibleHitTicks(hits, "low", 0.5, 0, 5, toPx);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.index).toBe(0);          // hits[0] → hit-low-0
    expect(ticks[0]!.band).toBe("low");
    expect(ticks[0]!.px).toBe(10);
    expect(ticks[0]!.strength).toBeCloseTo(0.9, 9);
  });

  it("しきい値0では範囲・band内の全ヒットを返す", () => {
    expect(visibleHitTicks(hits, "low", 0, 0, 5, toPx).map((t) => t.index)).toEqual([0, 1]);
  });

  it("index は全ヒット配列の添字(deriveMarkers の hit-{band}-{i} と一致)", () => {
    expect(visibleHitTicks(hits, "mid", 0, 0, 5, toPx)[0]!.index).toBe(2);
  });
});
```

`app/src/renderer/__tests__/HitLanes.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HitLanes } from "../components/HitLanes.js";
import type { Viewport } from "../editor/waveGeom.js";
import type { HitInfo } from "../../shared/types.js";

const vp: Viewport = { scrollSec: 0, samplesPerPx: 512, sampleRate: 44100, widthPx: 800 };
const hits: HitInfo[] = [
  { timeSec: 1.0, band: "low", strength: 0.9 },
  { timeSec: 2.0, band: "mid", strength: 0.8 },
];

describe("HitLanes", () => {
  it("帯域スライダー変更で EDIT_APPLIED {hitThreshold:{…,[band]:v}} を発火", () => {
    const dispatch = vi.fn();
    render(
      <HitLanes hits={hits} threshold={{ low: 0.1, mid: 0.2, high: 0.3 }}
        viewport={vp} selectedMarkerId={null} dispatch={dispatch} />,
    );
    fireEvent.change(screen.getByLabelText("低域 感度"), { target: { value: "0.7" } });
    expect(dispatch).toHaveBeenCalledWith({
      type: "EDIT_APPLIED",
      edit: { hitThreshold: { low: 0.7, mid: 0.2, high: 0.3 } },
    });
  });

  it("ティッククリックで MARKER_SELECTED(hit-{band}-{index})", () => {
    const dispatch = vi.fn();
    render(
      <HitLanes hits={hits} threshold={{ low: 0, mid: 0, high: 0 }}
        viewport={vp} selectedMarkerId={null} dispatch={dispatch} />,
    );
    fireEvent.click(screen.getByLabelText("hit low 0"));
    expect(dispatch).toHaveBeenCalledWith({ type: "MARKER_SELECTED", markerId: "hit-low-0" });
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd /home/claude/beatmarks/app && npx vitest run src/renderer/__tests__/hitLaneModel.test.ts src/renderer/__tests__/HitLanes.test.tsx`
Expected: FAIL — `Cannot find module '../editor/hitLaneModel.js'` / `'../components/HitLanes.js'`

- [ ] **Step 4: 実装**

`app/src/renderer/editor/hitLaneModel.ts`:

```ts
/** ヒットレーンの表示ティック(純ロジック)。deriveMarkers と同一の
 *  「strength < threshold は除外(faintにしない)」規則を守る。T5(waveGeom)には
 *  依存せず、範囲(fromSec/toSec)と座標変換(toPx)を引数で受ける。 */
import type { Band, HitInfo } from "../../shared/types.js";

export const HIT_BANDS: Band[] = ["low", "mid", "high"];

export interface HitTick {
  index: number;   // analysis.hits の配列添字(= deriveMarkers の hit-{band}-{index})
  band: Band;
  px: number;      // レーン内 X
  strength: number;
}

export function visibleHitTicks(
  hits: HitInfo[], band: Band, threshold: number,
  fromSec: number, toSec: number, toPx: (sec: number) => number,
): HitTick[] {
  const out: HitTick[] = [];
  hits.forEach((h, index) => {
    if (h.band !== band) return;
    if (h.strength < threshold) return;                 // deriveMarkers と同一
    if (h.timeSec < fromSec || h.timeSec > toSec) return;
    out.push({ index, band, px: toPx(h.timeSec), strength: h.strength });
  });
  return out;
}
```

`app/src/renderer/components/HitLanes.tsx`:

```tsx
/** 帯域別ヒットレーン+感度スライダー(スペック §7、モック .hitlane 準拠)。
 *  しきい値未満/削除済みは非表示(deriveMarkers のフィルタと一致)。 */
import React from "react";

import { HIT_COLORS } from "../../shared/deriveMarkers.js";
import type { Band, HitInfo } from "../../shared/types.js";
import { HIT_BANDS, visibleHitTicks } from "../editor/hitLaneModel.js";
import { secToPx, visibleRange, type Viewport } from "../editor/waveGeom.js";
import type { Action } from "../state/store.js";

const S = { title: "ヒット検出レーン", low: "低域", mid: "中域", high: "高域", sens: "感度" };
const BAND_LABEL: Record<Band, string> = { low: S.low, mid: S.mid, high: S.high };

interface HitLanesProps {
  hits: HitInfo[];
  threshold: { low: number; mid: number; high: number };
  viewport: Viewport;
  selectedMarkerId: string | null;
  dispatch: (a: Action) => void;
}

export function HitLanes(props: HitLanesProps): React.JSX.Element {
  const { hits, threshold, viewport, selectedMarkerId, dispatch } = props;
  const { fromSec, toSec } = visibleRange(viewport);
  const toPx = (sec: number): number => secToPx(sec, viewport);

  return (
    <div style={styles.wrap}>
      <span style={styles.lanetag}>{S.title}</span>
      {HIT_BANDS.map((band) => {
        const color = HIT_COLORS[band];
        const ticks = visibleHitTicks(hits, band, threshold[band], fromSec, toSec, toPx);
        return (
          <div key={band} style={styles.lane}>
            <span style={{ ...styles.bandtag, color }}>{BAND_LABEL[band]}</span>
            <div style={styles.strip}>
              {ticks.map((t) => {
                const id = `hit-${band}-${t.index}`;
                return (
                  <div
                    key={t.index}
                    role="button"
                    aria-label={`hit ${band} ${t.index}`}
                    onClick={() => dispatch({ type: "MARKER_SELECTED", markerId: id })}
                    style={{
                      position: "absolute", left: t.px, bottom: 0, width: 2,
                      height: 5 + t.strength * 15, transform: "translateX(-1px)",
                      background: color, opacity: 0.35 + 0.65 * t.strength, cursor: "pointer",
                      outline: id === selectedMarkerId ? "1px solid #fff" : undefined,
                    }}
                  />
                );
              })}
            </div>
            <input
              type="range" min={0} max={1} step={0.01} value={threshold[band]}
              aria-label={`${BAND_LABEL[band]} ${S.sens}`}
              style={styles.slider}
              onChange={(e) =>
                dispatch({
                  type: "EDIT_APPLIED",
                  edit: { hitThreshold: { ...threshold, [band]: Number(e.target.value) } },
                })
              }
            />
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { position: "relative", background: "#0d0f13", borderTop: "1px solid #262c36", padding: "2px 14px 4px" },
  lanetag: { color: "#5a6272", fontSize: 10, background: "rgba(20,23,28,.8)", padding: "2px 6px", borderRadius: 4 },
  lane: { display: "flex", alignItems: "center", gap: 8, height: 22 },
  bandtag: { width: 34, fontSize: 10, flex: "none" },
  strip: { position: "relative", flex: "1 1 auto", height: "100%" },
  slider: { width: 70, flex: "none", accentColor: "#ff4d6b" },
};
```

- [ ] **Step 5: テスト・ビルド確認**

Run: `cd /home/claude/beatmarks/app && npx vitest run && npx tsc --noEmit && npx tsc -p tsconfig.node.json --noEmit && npx electron-vite build 2>&1 | tail -3`
Expected: 全 vitest 緑(本タスク追加分5件を含む)、typecheck OK、ビルド成功

- [ ] **Step 6: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/renderer/editor/hitLaneModel.ts app/src/renderer/components/HitLanes.tsx \
  app/src/renderer/__tests__/hitLaneModel.test.ts app/src/renderer/__tests__/HitLanes.test.tsx
git commit -m "feat(app): 帯域別ヒットレーンと感度スライダー(しきい値即反映)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SR5fj8BNeN6TUFgoj4zhm6"
```

---

### Task 8: グリッド補正バー+数値直接入力

**Files:**
- Create: `app/src/renderer/editor/gridModel.ts`(純: 実効BPM/BPMパース/オフセット整形/拍子ラベル/キー表示)
- Create: `app/src/renderer/components/NumericField.tsx`
- Create: `app/src/renderer/components/GridBar.tsx`
- Test: `app/src/renderer/__tests__/gridModel.test.ts`、`NumericField.test.tsx`、`GridBar.test.tsx`

**Interfaces:**
- Consumes(既存): `AnalysisResult`、`EditState`、`Action`(`EDIT_APPLIED`/`UNDO`/`REDO`)。
- Produces:
  - `NumericField` props: `{ value: string; onCommit(text: string): boolean; width?: number; ariaLabel?: string; title?: string }` — クリックで入力モード(全選択)、Enter/blur で `onCommit`(false→元値へ復帰+shake)、Esc キャンセル。
  - `GridBar` props: `{ analysis, edits, playheadSec, canUndo, canRedo, dispatch }`。
- `canUndo`/`canRedo` は `state.undo.length>0`/`state.redo.length>0` を EditorScreen(T12)が算出して渡す。

- [ ] **Step 1: 失敗するテストを書く**

`app/src/renderer/__tests__/gridModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { effectiveBpm, formatOffsetMs, keyLabel, parseBpm, timeSigLabel } from "../editor/gridModel.js";
import { defaultEditState } from "../../shared/validate.js";
import type { AnalysisResult } from "../../shared/types.js";

function analysis(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    durationSec: 30, tempoMode: "fixed", bpm: 128, gridOffsetSec: 0, beats: [], downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "E minor", camelot: "9A", confidence: 0.86 }, perSection: [] },
    sections: [], hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] }, ...over,
  };
}

describe("gridModel", () => {
  it("effectiveBpm: fixed は analysis.bpm、override 優先、variable は可変", () => {
    expect(effectiveBpm(analysis(), defaultEditState())).toMatchObject({ label: "128.00", value: 128, fixed: true, overridden: false });
    expect(effectiveBpm(analysis(), { ...defaultEditState(), bpmOverride: 140 })).toMatchObject({ label: "140.00", overridden: true });
    expect(effectiveBpm(analysis({ tempoMode: "variable", bpm: null }), defaultEditState())).toMatchObject({ label: "可変", value: null, fixed: false });
  });

  it("parseBpm: 30..300 のみ許可", () => {
    expect(parseBpm("128.5")).toBeCloseTo(128.5, 9);
    expect(parseBpm("29")).toBeNull();
    expect(parseBpm("301")).toBeNull();
    expect(parseBpm("abc")).toBeNull();
  });

  it("formatOffsetMs: 符号付きms", () => {
    expect(formatOffsetMs(0.023)).toBe("+23ms");
    expect(formatOffsetMs(-0.01)).toBe("-10ms");
    expect(formatOffsetMs(0)).toBe("+0ms");
  });

  it("timeSigLabel / keyLabel", () => {
    expect(timeSigLabel(6)).toBe("6/8");
    expect(timeSigLabel(3)).toBe("3/4");
    expect(keyLabel(analysis())).toBe("E minor · 9A");
  });
});
```

`app/src/renderer/__tests__/NumericField.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NumericField } from "../components/NumericField.js";

describe("NumericField", () => {
  it("クリックで入力モード→有効値は onCommit(true) で確定", () => {
    const onCommit = vi.fn().mockReturnValue(true);
    render(<NumericField value="128.00" onCommit={onCommit} ariaLabel="bpm" />);
    fireEvent.click(screen.getByLabelText("bpm"));
    const input = screen.getByLabelText("bpm") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    fireEvent.change(input, { target: { value: "140" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("140");
  });

  it("無効値(onCommit=false)は元値へ復帰し shake クラスが付く", () => {
    const onCommit = vi.fn().mockReturnValue(false);
    render(<NumericField value="128.00" onCommit={onCommit} ariaLabel="bpm" />);
    fireEvent.click(screen.getByLabelText("bpm"));
    const input = screen.getByLabelText("bpm");
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const span = screen.getByLabelText("bpm");
    expect(span.textContent).toBe("128.00");
    expect(span.className).toContain("bm-shake");
  });

  it("Esc は onCommit を呼ばずキャンセル", () => {
    const onCommit = vi.fn().mockReturnValue(true);
    render(<NumericField value="128.00" onCommit={onCommit} ariaLabel="bpm" />);
    fireEvent.click(screen.getByLabelText("bpm"));
    fireEvent.keyDown(screen.getByLabelText("bpm"), { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("bpm").textContent).toBe("128.00");
  });
});
```

`app/src/renderer/__tests__/GridBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GridBar } from "../components/GridBar.js";
import { defaultEditState } from "../../shared/validate.js";
import type { AnalysisResult } from "../../shared/types.js";

const analysis: AnalysisResult = {
  durationSec: 30, tempoMode: "fixed", bpm: 128, gridOffsetSec: 0, beats: [], downbeatPhase: 0,
  tempoMap: [], key: { global: { name: "E minor", camelot: "9A", confidence: 0.86 }, perSection: [] },
  sections: [], hits: [], silences: [],
  envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
};

function setup(over = {}) {
  const dispatch = vi.fn();
  render(<GridBar analysis={analysis} edits={{ ...defaultEditState(), ...over }}
    playheadSec={12.5} canUndo={true} canRedo={false} dispatch={dispatch} />);
  return dispatch;
}

describe("GridBar", () => {
  it("BPM を確定すると EDIT_APPLIED {bpmOverride}、範囲外は無視", () => {
    const dispatch = setup();
    fireEvent.click(screen.getByLabelText("BPM"));
    fireEvent.change(screen.getByLabelText("BPM"), { target: { value: "140" } });
    fireEvent.keyDown(screen.getByLabelText("BPM"), { key: "Enter" });
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { bpmOverride: 140 } });
    dispatch.mockClear();
    fireEvent.click(screen.getByLabelText("BPM"));
    fireEvent.change(screen.getByLabelText("BPM"), { target: { value: "400" } });
    fireEvent.keyDown(screen.getByLabelText("BPM"), { key: "Enter" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("オフセット +1ms / 拍子6/8 / 1拍目→ / アンカー設定 が正しい払い出し", () => {
    const dispatch = setup({ gridOffsetDeltaSec: 0.02, downbeatShift: 0 });
    fireEvent.click(screen.getByText("+1ms"));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.021 } });
    fireEvent.change(screen.getByLabelText("拍子"), { target: { value: "6/8" } });
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { beatsPerBar: 6 } });
    fireEvent.click(screen.getByText("→"));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { downbeatShift: 1 } });
    fireEvent.click(screen.getByText("アンカー設定"));
    expect(dispatch).toHaveBeenCalledWith({ type: "EDIT_APPLIED", edit: { gridAnchor: { timeSec: 12.5, freeBefore: true } } });
  });

  it("Undo/Redo ボタン: canUndo=true で有効/UNDO、canRedo=false で無効", () => {
    const dispatch = setup();
    const redo = screen.getByLabelText("やり直し") as HTMLButtonElement;
    expect(redo.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("取り消し"));
    expect(dispatch).toHaveBeenCalledWith({ type: "UNDO" });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /home/claude/beatmarks/app && npx vitest run src/renderer/__tests__/gridModel.test.ts src/renderer/__tests__/NumericField.test.tsx src/renderer/__tests__/GridBar.test.tsx`
Expected: FAIL — `Cannot find module '../editor/gridModel.js'` ほか

- [ ] **Step 3: 実装**

`app/src/renderer/editor/gridModel.ts`:

```ts
/** グリッド補正バーの純ロジック。BPM/オフセット/拍子/キー表示の導出とパース。 */
import type { AnalysisResult, EditState } from "../../shared/types.js";

export interface BpmDisplay { label: string; value: number | null; fixed: boolean; overridden: boolean; }

export function effectiveBpm(analysis: AnalysisResult, edits: EditState): BpmDisplay {
  const ov = edits.bpmOverride;
  if (ov !== undefined && Number.isFinite(ov) && ov > 0) {
    return { label: ov.toFixed(2), value: ov, fixed: true, overridden: true };
  }
  if (analysis.tempoMode === "fixed" && analysis.bpm != null) {
    return { label: analysis.bpm.toFixed(2), value: analysis.bpm, fixed: true, overridden: false };
  }
  return { label: "可変", value: null, fixed: false, overridden: false };
}

/** 30..300 のみ許可(スペック §3.1)。それ以外は null。 */
export function parseBpm(text: string): number | null {
  const v = Number(text.trim());
  if (!Number.isFinite(v) || v < 30 || v > 300) return null;
  return v;
}

export function formatOffsetMs(sec: number): string {
  const ms = Math.round(sec * 1000);
  return `${ms >= 0 ? "+" : ""}${ms}ms`;
}

export const TIME_SIG_OPTIONS: { label: string; beatsPerBar: number }[] = [
  { label: "4/4", beatsPerBar: 4 },
  { label: "3/4", beatsPerBar: 3 },
  { label: "6/8", beatsPerBar: 6 },
];

export function timeSigLabel(beatsPerBar: number): string {
  return TIME_SIG_OPTIONS.find((o) => o.beatsPerBar === beatsPerBar)?.label ?? "4/4";
}

export function beatsPerBarFromLabel(label: string): number {
  return TIME_SIG_OPTIONS.find((o) => o.label === label)?.beatsPerBar ?? 4;
}

export function keyLabel(analysis: AnalysisResult): string {
  const k = analysis.key.global;
  return `${k.name} · ${k.camelot}`;
}
```

`app/src/renderer/components/NumericField.tsx`:

```tsx
/** クリックで直接入力できる数値/時刻フィールド(DAW的操作感、スペック §7)。
 *  Enter/blur で onCommit。onCommit が false を返すと元値へ復帰し shake。Esc でキャンセル。 */
import React, { useEffect, useRef, useState } from "react";

let shakeInjected = false;
function ensureShakeStyle(): void {
  if (shakeInjected || typeof document === "undefined") return;
  shakeInjected = true;
  const el = document.createElement("style");
  el.textContent =
    "@keyframes bm-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}" +
    ".bm-shake{animation:bm-shake .3s}";
  document.head.appendChild(el);
}

interface Props {
  value: string;
  onCommit: (text: string) => boolean;
  width?: number;
  ariaLabel?: string;
  title?: string;
}

export function NumericField(props: Props): React.JSX.Element {
  const { value, onCommit, width = 64, ariaLabel, title } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function begin(): void { ensureShakeStyle(); setDraft(value); setEditing(true); }
  function commit(): void {
    if (onCommit(draft)) { setEditing(false); }
    else { setEditing(false); setShake(true); window.setTimeout(() => setShake(false), 400); }
  }
  function cancel(): void { setEditing(false); }

  if (editing) {
    return (
      <input
        ref={inputRef} aria-label={ariaLabel} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        style={{ width, background: "#0a0c10", color: "#e8ebf0", border: "1px solid #3a4250", borderRadius: 4, padding: "2px 6px", fontFamily: "inherit" }}
      />
    );
  }
  return (
    <span
      role="button" tabIndex={0} aria-label={ariaLabel} title={title}
      onClick={begin}
      onKeyDown={(e) => { if (e.key === "Enter") begin(); }}
      className={shake ? "bm-shake" : undefined}
      style={{ display: "inline-block", minWidth: width, cursor: "text", color: "#e8ebf0" }}
    >
      {value}
    </span>
  );
}
```

`app/src/renderer/components/GridBar.tsx`:

```tsx
/** グリッド補正バー(モック ツールバー2 準拠、スペック §7)。BPM・オフセット nudge・
 *  拍子・1拍目ずらし・アンカー・キー表示・Undo/Redo。値はすべて EDIT_APPLIED で払い出す。 */
import React from "react";

import type { AnalysisResult, EditState } from "../../shared/types.js";
import {
  beatsPerBarFromLabel, effectiveBpm, formatOffsetMs, keyLabel, parseBpm, timeSigLabel, TIME_SIG_OPTIONS,
} from "../editor/gridModel.js";
import type { Action } from "../state/store.js";
import { NumericField } from "./NumericField.js";

const S = {
  bpm: "BPM", fixed: "固定", variable: "可変", offset: "グリッドオフセット", timeSig: "拍子",
  downbeat: "1拍目", anchorSet: "アンカー設定", anchorClear: "アンカー解除", key: "KEY",
  undo: "取り消し", redo: "やり直し",
};

interface GridBarProps {
  analysis: AnalysisResult;
  edits: EditState;
  playheadSec: number;
  canUndo: boolean;
  canRedo: boolean;
  dispatch: (a: Action) => void;
}

export function GridBar(props: GridBarProps): React.JSX.Element {
  const { analysis, edits, playheadSec, canUndo, canRedo, dispatch } = props;
  const bpm = effectiveBpm(analysis, edits);
  const apply = (edit: Partial<EditState>): void => dispatch({ type: "EDIT_APPLIED", edit });

  return (
    <div style={styles.toolbar}>
      {/* BPM */}
      <div style={styles.group}>
        <span style={styles.glabel}>{S.bpm}</span>
        <span style={styles.bigval}>
          <NumericField
            value={bpm.label} ariaLabel="BPM" width={58}
            onCommit={(text) => {
              const v = parseBpm(text);
              if (v === null) return false;
              apply({ bpmOverride: v });
              return true;
            }}
          />
        </span>
        <span style={{ ...styles.chip, color: bpm.fixed ? "#7ddc9a" : "#8b94a3" }}>
          {bpm.fixed ? S.fixed : S.variable}
        </span>
        <button onClick={() => apply({ bpmOverride: (bpm.value ?? 120) / 2 })}>½</button>
        <button onClick={() => apply({ bpmOverride: (bpm.value ?? 120) * 2 })}>×2</button>
      </div>

      {/* オフセット */}
      <div style={styles.group}>
        <span style={styles.glabel}>{S.offset}</span>
        <button onClick={() => apply({ gridOffsetDeltaSec: edits.gridOffsetDeltaSec - 0.01 })}>−10ms</button>
        <button onClick={() => apply({ gridOffsetDeltaSec: edits.gridOffsetDeltaSec - 0.001 })}>−1ms</button>
        <span style={styles.offval}>{formatOffsetMs(edits.gridOffsetDeltaSec)}</span>
        <button onClick={() => apply({ gridOffsetDeltaSec: edits.gridOffsetDeltaSec + 0.001 })}>+1ms</button>
        <button onClick={() => apply({ gridOffsetDeltaSec: edits.gridOffsetDeltaSec + 0.01 })}>+10ms</button>
      </div>

      {/* 拍子 + 1拍目ずらし */}
      <div style={styles.group}>
        <span style={styles.glabel}>{S.timeSig}</span>
        <select
          aria-label="拍子" value={timeSigLabel(edits.beatsPerBar)} style={styles.select}
          onChange={(e) => apply({ beatsPerBar: beatsPerBarFromLabel(e.target.value) })}
        >
          {TIME_SIG_OPTIONS.map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
        </select>
        <button title="小節頭を1拍前へ" onClick={() => apply({ downbeatShift: edits.downbeatShift - 1 })}>
          {S.downbeat} ←
        </button>
        <button title="小節頭を1拍後へ" onClick={() => apply({ downbeatShift: edits.downbeatShift + 1 })}>→</button>
      </div>

      {/* アンカー */}
      <div style={styles.group}>
        <button onClick={() => apply({ gridAnchor: { timeSec: playheadSec, freeBefore: true } })}>{S.anchorSet}</button>
        <button disabled={!edits.gridAnchor} onClick={() => apply({ gridAnchor: undefined })}>{S.anchorClear}</button>
      </div>

      {/* キー表示(表示のみ) */}
      <span style={{ ...styles.chip }}>
        {S.key} <b style={{ color: "#9ecbff" }}>{keyLabel(analysis)}</b>
        <span style={{ color: "#5a6272" }}>（信頼度 {analysis.key.global.confidence.toFixed(2)}）</span>
      </span>

      {/* Undo/Redo */}
      <div style={{ ...styles.group, marginLeft: "auto" }}>
        <button aria-label={S.undo} disabled={!canUndo} onClick={() => dispatch({ type: "UNDO" })}>↶</button>
        <button aria-label={S.redo} disabled={!canRedo} onClick={() => dispatch({ type: "REDO" })}>↷</button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: { display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", background: "#14171c", borderBottom: "1px solid #262c36", flexWrap: "nowrap" },
  group: { display: "flex", alignItems: "center", gap: 6, background: "#191d24", border: "1px solid #262c36", borderRadius: 8, padding: "4px 8px" },
  glabel: { color: "#5a6272", fontSize: 10, marginRight: 2, whiteSpace: "nowrap" },
  bigval: { fontSize: 15, fontWeight: 700, fontFamily: "monospace" },
  chip: { background: "#1f242d", border: "1px solid #262c36", borderRadius: 6, padding: "3px 8px", color: "#e8ebf0", fontSize: 11 },
  offval: { fontFamily: "monospace", color: "#ffd166", minWidth: 52, textAlign: "center" },
  select: { background: "#1f242d", color: "#e8ebf0", border: "1px solid #262c36", borderRadius: 6, padding: "4px 6px", fontSize: 11 },
};
```

- [ ] **Step 4: テスト・ビルド確認**

Run: `cd /home/claude/beatmarks/app && npx vitest run && npx tsc --noEmit && npx tsc -p tsconfig.node.json --noEmit && npx electron-vite build 2>&1 | tail -3`
Expected: 全 vitest 緑(本タスク追加分10件を含む)、typecheck OK、ビルド成功

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/renderer/editor/gridModel.ts app/src/renderer/components/NumericField.tsx \
  app/src/renderer/components/GridBar.tsx \
  app/src/renderer/__tests__/gridModel.test.ts app/src/renderer/__tests__/NumericField.test.tsx \
  app/src/renderer/__tests__/GridBar.test.tsx
git commit -m "feat(app): グリッド補正バーとクリック直接入力の数値フィールド

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SR5fj8BNeN6TUFgoj4zhm6"
```

---
### Task 9: マーカーテーブル+手動マーカー

**Files:**
- Modify: `app/src/renderer/state/store.ts`(`CUSTOM_MARKER_UPDATED`/`MARKER_RESTORED` アクション追加)
- Create: `app/src/renderer/editor/markerTableModel.ts`(純: 行の組立/フィルタ/ID解決)
- Create: `app/src/renderer/components/MarkerTable.tsx`
- Test: `app/src/renderer/__tests__/markerActions.test.ts`、`markerTableModel.test.ts`、`MarkerTable.test.tsx`

**Interfaces:**
- Consumes(既存): `deriveMarkers`(`shared/deriveMarkers.js`)、`SourceState`/`EditorProject`(`state/store.js`)、`Marker`/`MarkerType`/`Fps`/`RoundingMode`、`timeToFrame`/`formatTimecode`/`formatSeconds`(`shared/timebase.js`)、`SECTION_EDIT_ADDED`/`MARKER_DELETED`/`MARKER_SELECTED`。
- Produces(store 追加):
  - `{ type: "CUSTOM_MARKER_UPDATED"; id: string; patch: Partial<Pick<Marker,"label"|"timeSec">> }` — 手動マーカーのラベル変更(T9)と時刻移動(T12 の nudge)兼用。
  - `{ type: "MARKER_RESTORED"; id: string }` — `deletedMarkerIds` から除去(undo 対象)。
- Produces: `MarkerTable`(フィルタ/ジャンプ/リネーム/削除/復元/ソース横断)。`onSeek(sec)` と `onAddMarker()` は親(T12)が渡す(M キー本体は T12)。
- 判断メモ: セレクタは単一スロットキャッシュ(active専用)なので、ソース横断は `deriveMarkers` を各ソースに直接適用する(MVPの件数では性能十分 — 注記済み)。時刻列はモック準拠で TC/フレーム/秒の3固定列(単位切替の単一列にはしない)。

- [ ] **Step 1: store 追加分の失敗テストを書く**

`app/src/renderer/__tests__/markerActions.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { AnalyzedProject } from "../../shared/ipc.js";
import type { AnalysisResult, Marker } from "../../shared/types.js";
import { initialState, reducer, type AppState } from "../state/store.js";

function analysis(): AnalysisResult {
  return {
    durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25,
    beats: [0.25, 0.75], downbeatPhase: 0, tempoMap: [{ timeSec: 0, bpm: 120 }],
    key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [{ startSec: 0, endSec: 10, label: "A", clusterId: 0, chorusCandidate: false }],
    hits: [], silences: [],
    envelopes: { sampleRateHz: 100, total: Array(1000).fill(0.5), low: [], mid: [], high: [] },
  };
}
function project(): AnalyzedProject {
  return {
    mediaPath: "/m/t.mp4", mediaHash: "h".repeat(64), baseName: "t", playbackWavPath: "/tmp/p.wav",
    durationSec: 10,
    sources: [{ source: { id: "mix", kind: "mix", label: "2mix" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/a.wav" }],
  };
}
const custom: Marker = { id: "custom-1", sourceId: "mix", timeSec: 3, type: "custom", label: "旧", color: "#ffd166", source: "user" };
function editor(): AppState {
  let s = reducer(initialState(), { type: "PROJECT_READY", project: project() });
  return reducer(s, { type: "CUSTOM_MARKER_ADDED", marker: custom });
}
function edits(s: AppState) {
  if (s.phase !== "editor") throw new Error("not editor");
  return s.project.sources[0]!.edits;
}

describe("CUSTOM_MARKER_UPDATED / MARKER_RESTORED", () => {
  it("patch.label でラベル変更", () => {
    const s = reducer(editor(), { type: "CUSTOM_MARKER_UPDATED", id: "custom-1", patch: { label: "新" } });
    expect(edits(s).customMarkers[0]!.label).toBe("新");
  });
  it("patch.timeSec で時刻移動(nudge用)", () => {
    const s = reducer(editor(), { type: "CUSTOM_MARKER_UPDATED", id: "custom-1", patch: { timeSec: 3.01 } });
    expect(edits(s).customMarkers[0]!.timeSec).toBeCloseTo(3.01, 9);
  });
  it("MARKER_DELETED→MARKER_RESTORED でラウンドトリップし undo できる", () => {
    let s = reducer(editor(), { type: "MARKER_DELETED", id: "beat-0" });
    expect(edits(s).deletedMarkerIds).toContain("beat-0");
    s = reducer(s, { type: "MARKER_RESTORED", id: "beat-0" });
    expect(edits(s).deletedMarkerIds).not.toContain("beat-0");
    s = reducer(s, { type: "UNDO" }); // 復元を取り消し → 再び削除済み
    expect(edits(s).deletedMarkerIds).toContain("beat-0");
  });
});
```

`app/src/renderer/__tests__/markerTableModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { deletedRows, filterByType, sectionIndexFromMarkerId, typeLabel } from "../editor/markerTableModel.js";
import { defaultEditState } from "../../shared/validate.js";
import type { SourceState } from "../state/store.js";
import type { AnalysisResult } from "../../shared/types.js";

const analysis: AnalysisResult = {
  durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25, beats: [0.25, 0.75],
  downbeatPhase: 0, tempoMap: [], key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
  sections: [{ startSec: 0, endSec: 10, label: "A", clusterId: 0, chorusCandidate: false }],
  hits: [], silences: [], envelopes: { sampleRateHz: 100, total: Array(1000).fill(0.5), low: [], mid: [], high: [] },
};
const src: SourceState = { source: { id: "mix", kind: "mix", label: "2mix" }, analysis, warnings: [], edits: { ...defaultEditState(), deletedMarkerIds: ["beat-0"] } };

describe("markerTableModel", () => {
  it("deletedRows は削除フィルタを外して復元候補を返す", () => {
    const rows = deletedRows(src);
    expect(rows.map((r) => r.marker.id)).toContain("beat-0");
  });
  it("filterByType", () => {
    const rows = deletedRows(src);
    expect(filterByType(rows, new Set(["section"]))).toHaveLength(0);
    expect(filterByType(rows, new Set(["beat"]))).toHaveLength(1);
  });
  it("sectionIndexFromMarkerId: o=元添字, a=元長+k", () => {
    expect(sectionIndexFromMarkerId("sec-o3", 5)).toBe(3);
    expect(sectionIndexFromMarkerId("sec-a1", 5)).toBe(6);
    expect(sectionIndexFromMarkerId("beat-0", 5)).toBeNull();
  });
  it("typeLabel", () => {
    expect(typeLabel({ ...({} as never), type: "section" })).toBe("セクション");
  });
});
```

`app/src/renderer/__tests__/MarkerTable.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarkerTable } from "../components/MarkerTable.js";
import { defaultEditState } from "../../shared/validate.js";
import type { SourceState } from "../state/store.js";
import type { AnalysisResult, Marker } from "../../shared/types.js";

const custom: Marker = { id: "custom-1", sourceId: "mix", timeSec: 3, type: "custom", label: "フラッシュ", color: "#ffd166", source: "user" };
const analysis: AnalysisResult = {
  durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25, beats: [0.25], downbeatPhase: 0,
  tempoMap: [], key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
  sections: [{ startSec: 0, endSec: 10, label: "A", clusterId: 0, chorusCandidate: false }],
  hits: [], silences: [], envelopes: { sampleRateHz: 100, total: Array(1000).fill(0.5), low: [], mid: [], high: [] },
};
function src(over = {}): SourceState {
  return { source: { id: "mix", kind: "mix", label: "2mix" }, analysis, warnings: [], edits: { ...defaultEditState(), customMarkers: [custom], ...over } };
}
function setup(over = {}) {
  const dispatch = vi.fn(); const onSeek = vi.fn(); const onAddMarker = vi.fn();
  const s = src(over);
  render(<MarkerTable activeSource={s} sources={[s]} fps={{ num: 30, den: 1 }} rounding="nearest"
    selectedMarkerId={null} dispatch={dispatch} onSeek={onSeek} onAddMarker={onAddMarker} />);
  return { dispatch, onSeek };
}

describe("MarkerTable", () => {
  it("行クリックで MARKER_SELECTED + onSeek", () => {
    const { dispatch, onSeek } = setup();
    fireEvent.click(screen.getByText("フラッシュ"));
    expect(dispatch).toHaveBeenCalledWith({ type: "MARKER_SELECTED", markerId: "custom-1" });
    expect(onSeek).toHaveBeenCalledWith(3);
  });
  it("削除ボタンで MARKER_DELETED", () => {
    const { dispatch } = setup();
    fireEvent.click(screen.getByLabelText("削除 custom-1"));
    expect(dispatch).toHaveBeenCalledWith({ type: "MARKER_DELETED", id: "custom-1" });
  });
  it("手動マーカーのリネームで CUSTOM_MARKER_UPDATED{patch:{label}}", () => {
    const { dispatch } = setup();
    fireEvent.click(screen.getByLabelText("リネーム custom-1"));
    const input = screen.getByLabelText("ラベル編集 custom-1");
    fireEvent.change(input, { target: { value: "花火" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatch).toHaveBeenCalledWith({ type: "CUSTOM_MARKER_UPDATED", id: "custom-1", patch: { label: "花火" } });
  });
  it("削除済みトグルで復元行を表示し MARKER_RESTORED", () => {
    const { dispatch } = setup({ deletedMarkerIds: ["beat-0"] });
    fireEvent.click(screen.getByLabelText("削除済みを表示"));
    fireEvent.click(screen.getByLabelText("復元 beat-0"));
    expect(dispatch).toHaveBeenCalledWith({ type: "MARKER_RESTORED", id: "beat-0" });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /home/claude/beatmarks/app && npx vitest run src/renderer/__tests__/markerActions.test.ts src/renderer/__tests__/markerTableModel.test.ts src/renderer/__tests__/MarkerTable.test.tsx`
Expected: FAIL — 新アクションが型に無い / `Cannot find module '../editor/markerTableModel.js'` / `'../components/MarkerTable.js'`

- [ ] **Step 3: store にアクションを追加**

`app/src/renderer/state/store.ts` の `Action` union に2行追加(`MARKER_DELETED` の直後など):

```ts
  | { type: "CUSTOM_MARKER_UPDATED"; id: string; patch: Partial<Pick<Marker, "label" | "timeSec">> }
  | { type: "MARKER_RESTORED"; id: string }
```

上段の「フェーズ非依存アクションのフォールスルー break」一覧(`case "MARKER_DELETED":` などが並ぶ箇所)に2つ追加:

```ts
    case "CUSTOM_MARKER_UPDATED":
    case "MARKER_RESTORED":
```

editor 専用 switch の `case "MARKER_DELETED": { … }` の直後にケースを追加:

```ts
    case "CUSTOM_MARKER_UPDATED": {
      const cur = activeSource(state.project).edits;
      return withActiveEdits(state, {
        ...cur,
        customMarkers: cur.customMarkers.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)),
      });
    }
    case "MARKER_RESTORED": {
      const cur = activeSource(state.project).edits;
      return withActiveEdits(state, {
        ...cur,
        deletedMarkerIds: cur.deletedMarkerIds.filter((x) => x !== action.id),
      });
    }
```

> 両 switch の `never` 網羅性ガードは追加ケースを含めれば自動的に通る。含め忘れると `tsc` がここで落ちる(意図した安全弁)。

- [ ] **Step 4: markerTableModel と MarkerTable を実装**

`app/src/renderer/editor/markerTableModel.ts`:

```ts
/** マーカーテーブルの純ロジック(行の組立・フィルタ・ID解決)。 */
import { deriveMarkers } from "../../shared/deriveMarkers.js";
import type { Marker, MarkerType } from "../../shared/types.js";
import type { SourceState } from "../state/store.js";

export interface TableRow { marker: Marker; sourceLabel: string; }

export const ALL_MARKER_TYPES: MarkerType[] = ["section", "bar", "beat", "hit", "silence", "custom"];

export function activeRows(source: SourceState): TableRow[] {
  return deriveMarkers(source.analysis, source.edits, source.source.id)
    .map((m) => ({ marker: m, sourceLabel: source.source.label }));
}

export function crossSourceRows(sources: SourceState[]): TableRow[] {
  return sources
    .flatMap((s) => deriveMarkers(s.analysis, s.edits, s.source.id).map((m) => ({ marker: m, sourceLabel: s.source.label })))
    .sort((a, b) => a.marker.timeSec - b.marker.timeSec);
}

/** 削除済み(復元候補)。削除フィルタを外して derive し、deletedMarkerIds の物だけ。 */
export function deletedRows(source: SourceState): TableRow[] {
  const del = new Set(source.edits.deletedMarkerIds);
  if (del.size === 0) return [];
  const full = deriveMarkers(source.analysis, { ...source.edits, deletedMarkerIds: [] }, source.source.id);
  return full.filter((m) => del.has(m.id)).map((m) => ({ marker: m, sourceLabel: source.source.label }));
}

export function filterByType(rows: TableRow[], enabled: Set<MarkerType>): TableRow[] {
  return rows.filter((r) => enabled.has(r.marker.type));
}

/** sec-o{n}=元添字 n / sec-a{k}=元 sections 長 + k(types.ts の index 規則)。それ以外は null。 */
export function sectionIndexFromMarkerId(id: string, originalSectionCount: number): number | null {
  const m = /^sec-([oa])(\d+)$/.exec(id);
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] === "o" ? n : originalSectionCount + n;
}

export function typeLabel(marker: Marker): string {
  switch (marker.type) {
    case "section": return "セクション";
    case "bar": return "小節";
    case "beat": return "拍";
    case "hit": return `ヒット（${marker.meta?.band === "low" ? "低" : marker.meta?.band === "mid" ? "中" : "高"}）`;
    case "silence": return "静寂";
    case "custom": return "手動";
  }
}

export function rowLabel(marker: Marker): string {
  if (marker.type === "hit") return `強度 ${(marker.meta?.strength ?? 0).toFixed(2)}`;
  return marker.label;
}

export function isRenamable(marker: Marker): boolean {
  return marker.type === "custom" || marker.type === "section";
}
```

`app/src/renderer/components/MarkerTable.tsx`:

```tsx
/** マーカー一覧テーブル(モック .markers 準拠、スペック §7)。
 *  クリックでジャンプ+選択、種別フィルタ、リネーム/削除、削除済みの復元、ソース横断表示。 */
import React, { useState } from "react";

import type { Fps, MarkerType, RoundingMode } from "../../shared/types.js";
import { formatSeconds, formatTimecode, timeToFrame } from "../../shared/timebase.js";
import {
  activeRows, ALL_MARKER_TYPES, crossSourceRows, deletedRows, filterByType,
  isRenamable, rowLabel, sectionIndexFromMarkerId, typeLabel, type TableRow,
} from "../editor/markerTableModel.js";
import type { Action, SourceState } from "../state/store.js";

const TYPE_JA: Record<MarkerType, string> = {
  section: "セクション", bar: "小節", beat: "拍", hit: "ヒット", silence: "静寂", custom: "手動",
};
const DEFAULT_TYPES = new Set<MarkerType>(["section", "bar", "hit", "silence", "custom"]); // 拍は既定OFF(多い)

interface MarkerTableProps {
  activeSource: SourceState;
  sources: SourceState[];
  fps: Fps;
  rounding: RoundingMode;
  selectedMarkerId: string | null;
  dispatch: (a: Action) => void;
  onSeek: (sec: number) => void;
  onAddMarker: () => void;
}

export function MarkerTable(props: MarkerTableProps): React.JSX.Element {
  const { activeSource, sources, fps, rounding, selectedMarkerId, dispatch, onSeek, onAddMarker } = props;
  const [enabled, setEnabled] = useState<Set<MarkerType>>(new Set(DEFAULT_TYPES));
  const [cross, setCross] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const baseRows: TableRow[] = showDeleted
    ? deletedRows(activeSource)
    : cross ? crossSourceRows(sources) : activeRows(activeSource);
  const rows = filterByType(baseRows, enabled);
  const total = (cross ? crossSourceRows(sources) : activeRows(activeSource)).length;

  function toggleType(t: MarkerType): void {
    const next = new Set(enabled);
    next.has(t) ? next.delete(t) : next.add(t);
    setEnabled(next);
  }
  function startRename(id: string, label: string): void { setEditingId(id); setDraft(label); }
  function commitRename(row: TableRow): void {
    const label = draft.trim();
    setEditingId(null);
    if (!label) return;
    if (row.marker.type === "custom") {
      dispatch({ type: "CUSTOM_MARKER_UPDATED", id: row.marker.id, patch: { label } });
    } else {
      const idx = sectionIndexFromMarkerId(row.marker.id, activeSource.analysis.sections.length);
      if (idx !== null) dispatch({ type: "SECTION_EDIT_ADDED", op: { op: "rename", index: idx, label } });
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.title}>
        マーカー一覧 <span style={styles.count}>全 {total} 件（表示 {rows.length} 件）</span>
        <div style={styles.filters}>
          {ALL_MARKER_TYPES.map((t) => (
            <button key={t} onClick={() => toggleType(t)}
              style={enabled.has(t) ? styles.chipOn : styles.chip}>{TYPE_JA[t]}</button>
          ))}
          <button aria-label="削除済みを表示" onClick={() => setShowDeleted((v) => !v)}
            style={showDeleted ? styles.chipOn : styles.chip}>削除済み</button>
          <button onClick={() => setCross((v) => !v)} style={cross ? styles.chipOn : styles.chip}>ソース横断</button>
          <button onClick={onAddMarker} style={styles.chip}>＋追加</button>
        </div>
      </div>
      <div style={styles.tablewrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>種別</th><th style={styles.th}>ラベル</th>
              <th style={styles.th}>タイムコード</th><th style={styles.th}>フレーム</th><th style={styles.th}>秒</th>
              {cross && <th style={styles.th}>ソース</th>}
              <th style={styles.th}>出所</th><th style={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const m = row.marker;
              const frame = timeToFrame(m.timeSec, fps, rounding);
              const sel = m.id === selectedMarkerId;
              return (
                <tr key={m.id} style={sel ? styles.trSel : undefined}
                  onClick={() => { dispatch({ type: "MARKER_SELECTED", markerId: m.id }); onSeek(m.timeSec); }}>
                  <td style={styles.td}>
                    <span style={styles.typecell}>
                      <span style={{ ...styles.tdot, background: m.color }} />{typeLabel(m)}
                    </span>
                  </td>
                  <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                    {editingId === m.id ? (
                      <input autoFocus aria-label={`ラベル編集 ${m.id}`} value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => commitRename(row)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRename(row); else if (e.key === "Escape") setEditingId(null); }}
                        style={styles.input} />
                    ) : rowLabel(m)}
                  </td>
                  <td style={styles.tdMono}>{formatTimecode(frame, fps)}</td>
                  <td style={styles.tdMono}>{frame}</td>
                  <td style={styles.tdMono}>{formatSeconds(m.timeSec)}</td>
                  {cross && <td style={styles.td}>{row.sourceLabel}</td>}
                  <td style={{ ...styles.td, color: m.source === "user" ? "#ffd166" : "#5a6272" }}>
                    {m.source === "user" ? "手動" : "自動"}
                  </td>
                  <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                    {showDeleted ? (
                      <button aria-label={`復元 ${m.id}`} onClick={() => dispatch({ type: "MARKER_RESTORED", id: m.id })}>復元</button>
                    ) : (
                      <>
                        {isRenamable(m) && (
                          <button aria-label={`リネーム ${m.id}`} onClick={() => startRename(m.id, m.label)}>✎</button>
                        )}
                        <button aria-label={`削除 ${m.id}`} onClick={() => dispatch({ type: "MARKER_DELETED", id: m.id })}>🗑</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { flex: "1 1 auto", display: "flex", flexDirection: "column", minWidth: 0, borderRight: "1px solid #262c36" },
  title: { flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontWeight: 700, fontSize: 12, borderBottom: "1px solid #262c36" },
  count: { color: "#5a6272", fontWeight: 400 },
  filters: { marginLeft: "auto", display: "flex", gap: 4, flexWrap: "wrap" },
  chip: { fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "#1f242d", color: "#e8ebf0", border: "1px solid #262c36", cursor: "pointer" },
  chipOn: { fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "#1f242d", color: "#ff4d6b", border: "1px solid #ff4d6b", cursor: "pointer" },
  tablewrap: { flex: 1, overflow: "auto" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", color: "#5a6272", fontWeight: 600, fontSize: 10, padding: "5px 12px", borderBottom: "1px solid #262c36", position: "sticky", top: 0, background: "#14171c" },
  td: { padding: "5px 12px", borderBottom: "1px solid #1c212a", color: "#8b94a3" },
  tdMono: { padding: "5px 12px", borderBottom: "1px solid #1c212a", color: "#8b94a3", fontFamily: "monospace" },
  trSel: { background: "#232b3a" },
  typecell: { display: "inline-flex", alignItems: "center", gap: 5, color: "#e8ebf0", fontWeight: 600 },
  tdot: { width: 8, height: 8, borderRadius: 2, display: "inline-block" },
  input: { background: "#0a0c10", color: "#e8ebf0", border: "1px solid #3a4250", borderRadius: 4, padding: "1px 4px" },
};
```

- [ ] **Step 5: テスト・ビルド確認**

Run: `cd /home/claude/beatmarks/app && npx vitest run && npx tsc --noEmit && npx tsc -p tsconfig.node.json --noEmit && npx electron-vite build 2>&1 | tail -3`
Expected: 全 vitest 緑(本タスク追加分11件を含む)、typecheck OK、ビルド成功

- [ ] **Step 6: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/renderer/state/store.ts app/src/renderer/editor/markerTableModel.ts \
  app/src/renderer/components/MarkerTable.tsx app/src/renderer/__tests__/markerActions.test.ts \
  app/src/renderer/__tests__/markerTableModel.test.ts app/src/renderer/__tests__/MarkerTable.test.tsx
git commit -m "feat(app): マーカー一覧テーブル(フィルタ/リネーム/削除/復元/ソース横断)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SR5fj8BNeN6TUFgoj4zhm6"
```

---

### Task 10: 書き出しパネル+writeExports本実装

> 本計画の中核価値タスク。共有エクスポータ(計画②)を main の `writeExports` が呼び、ソース×ターゲットで実ファイルを吐く。

**Files:**
- Modify: `app/src/shared/ipc.ts`(`ExportRequest`/`WriteExportsResult` を契約形へ。`ExportFilePayload` 廃止。`chooseExportDir` 追加)
- Modify: `app/src/main/ipcRegistry.ts`(`MainDeps` の writeExports 差し替え+chooseExportDir)
- Modify: `app/src/main/index.ts`(writeExports 実配線+chooseExportDir ダイアログ)
- Modify: `app/src/preload/index.ts`(writeExports 署名変更+chooseExportDir)
- Modify: `app/src/main/__tests__/ipcRegistry-cancel.test.ts`(A の T1 テスト。`MainDeps` 必須化に追随して `deps()` を更新)
- Create: `app/src/main/exportWriter.ts`
- Create: `app/src/renderer/state/projectFile.ts`(`toProjectFileState`)
- Create: `app/src/renderer/state/exportFlow.ts`(ダイアログ→writeExports フロー)
- Create: `app/src/renderer/components/ExportPanel.tsx`
- Test: `app/src/main/__tests__/exportWriter.test.ts`、`app/src/shared/__tests__/exporters-midi-longlabel.test.ts`、`app/src/renderer/__tests__/ExportPanel.test.tsx`

**Interfaces:**
- Produces(ipc.ts):
```ts
export interface ExportRequest {
  targets: TargetKey[];
  sourceIds: string[];
  fps: Fps;
  rounding: RoundingMode;
  include: MarkerType[];
  includeEnvelopes: boolean;   // 契約差分#9
  destDir: string;
  projectState: ProjectFileState;
}
export interface WriteExportsResult { written: string[]; failed: { path: string; message: string }[]; }
// IpcApi: writeExports(req: ExportRequest): Promise<WriteExportsResult>;  chooseExportDir(): Promise<string | null>;
```
- Produces(main): `writeExports(req, deps): Promise<WriteExportsResult>` — ソース×ターゲットで `ExportContext` を組み立て(`timeSigDenominatorFor(beatsPerBar)` 必須・ハードコード4禁止)、`deriveMarkers`→`runExport`/`embedWavCues`→fs 書込。ファイル名衝突は exportWriter が dedup。
- Consumes: `runExport`/`TEXT_EXPORTERS`(`exporters/index.js`)、`embedWavCues`(`exporters/wavCues.js`)、`buildFileName`/`TARGETS`/`TargetKey`(`naming.js`)、`deriveMarkers`、`timeSigDenominatorFor`。

- [ ] **Step 1: ipc/registry/preload の型を契約形へ差し替え**

`app/src/shared/ipc.ts`:
- import 行を拡張: `import type { AnalysisResult, AudioSource, EditState, Fps, MarkerType, RoundingMode } from "./types.js";` と `import type { TargetKey } from "./naming.js";` を追加。
- `IPC_CHANNELS` に `chooseExportDir: "bm:chooseExportDir",` を追加。
- `ExportFilePayload` を削除し、次で置換:

```ts
export interface ExportRequest {
  targets: TargetKey[];
  sourceIds: string[];
  fps: Fps;
  rounding: RoundingMode;
  include: MarkerType[];
  includeEnvelopes: boolean;
  destDir: string;
  projectState: ProjectFileState;
}

export interface WriteExportsResult {
  written: string[];
  failed: { path: string; message: string }[];
}
```

- `IpcApi` の `writeExports` を差し替え、`chooseExportDir` を追加:

```ts
  writeExports(req: ExportRequest): Promise<WriteExportsResult>;
  chooseExportDir(): Promise<string | null>;
```

`app/src/main/ipcRegistry.ts`:
- import を `ExportRequest`/`WriteExportsResult` に変更(`ExportFilePayload` 除去)。
- `MainDeps` の `writeExports` を `(req: ExportRequest): Promise<WriteExportsResult>` に、`chooseExportDir(): Promise<string | null>` を追加。
- ハンドラ登録を差し替え:

```ts
  ipcMain.handle(IPC_CHANNELS.writeExports, (_e, req: ExportRequest) => deps.writeExports(req));
  ipcMain.handle(IPC_CHANNELS.chooseExportDir, () => deps.chooseExportDir());
```

`app/src/preload/index.ts`:
- import を `ExportRequest` に変更。
- api を差し替え:

```ts
  writeExports: (req: ExportRequest) => ipcRenderer.invoke(IPC_CHANNELS.writeExports, req),
  chooseExportDir: () => ipcRenderer.invoke(IPC_CHANNELS.chooseExportDir),
```

**A の T1 テストへの追随(必須)**: `MainDeps` に `chooseExportDir` を追加し `writeExports` の型を変えるため、A が T1 で作った `app/src/main/__tests__/ipcRegistry-cancel.test.ts` の `deps()` ファクトリ(全 `MainDeps` を構築)を更新する。`writeExports` の戻りを新 `WriteExportsResult` 形に直し、`chooseExportDir` を足す:

```ts
    writeExports: vi.fn(async () => ({ written: [], failed: [] })),   // ← dir 廃止に追随
    chooseExportDir: vi.fn(async () => null),                          // ← 追加(必須プロパティ)
```

(これを怠ると T10 適用時に `ipcRegistry-cancel.test.ts` が「Property 'chooseExportDir' is missing」で tsc に落ちる。)

- [ ] **Step 2: 失敗するテストを書く**

`app/src/main/__tests__/exportWriter.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

import { writeExports, type ExportWriterDeps } from "../exportWriter.js";
import type { ExportRequest, ProjectFileState } from "../../shared/ipc.js";
import type { EditState } from "../../shared/types.js";
import { defaultEditState, parseEngineResult } from "../../shared/validate.js";

const HERE = mkdtempSync(join(tmpdir(), "bmexport-"));
const engine = parseEngineResult(
  readFileSync(join(__dirname, "..", "..", "shared", "__fixtures__", "analysis-30s.json"), "utf-8"),
);

/** 決定的な 22050Hz/1ch 無音WAVを bytes で作る(integration-golden と同方式)。 */
function silentWav(durationSec: number): Uint8Array {
  const sr = 22050;
  const n = Math.round(durationSec * sr);
  const b = new Uint8Array(44 + n * 2);
  const dv = new DataView(b.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); w(8, "WAVE");
  w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, n * 2, true);
  return b;
}

function projectState(edits: EditState = defaultEditState(), mediaPath = "/media/track.mp4", sources = 1): ProjectFileState {
  const srcArr = Array.from({ length: sources }, (_, i) => ({
    source: { id: `mix${i}`, kind: "mix" as const, label: sources > 1 ? "same" : "2mix" },
    analysis: engine.analysis, edits,
  }));
  return {
    version: 1, mediaPath, mediaHash: "a".repeat(64), baseName: "track", playbackWavPath: "/tmp/p.wav",
    durationSec: engine.analysis.durationSec, sources: srcArr, activeSourceId: "mix0",
    ui: { fps: { num: 30, den: 1 }, rounding: "nearest" },
  };
}

function req(over: Partial<ExportRequest>): ExportRequest {
  return {
    targets: ["json"], sourceIds: ["mix0"], fps: { num: 30, den: 1 }, rounding: "nearest",
    include: ["section", "bar", "hit", "custom"], includeEnvelopes: true,
    destDir: mkdtempSync(join(tmpdir(), "bmdest-")), projectState: projectState(), ...over,
  };
}

const realDeps: ExportWriterDeps = {
  readFile: async (p) => new Uint8Array(await readFile(p)),
  writeFile: (p, d) => writeFile(p, typeof d === "string" ? d : Buffer.from(d)),
  extractWavForCues: async () => { throw new Error("not used"); },
  tmpWavPath: () => join(HERE, `cues-${Math.random()}.wav`),
};

describe("writeExports", () => {
  it("json/csv/midi を実ファイルに書き、パース可能", async () => {
    const r = req({ targets: ["json", "csv", "midi"] });
    const res = await writeExports(r, realDeps);
    expect(res.failed).toEqual([]);
    expect(res.written).toHaveLength(3);
    const jsonPath = res.written.find((p) => p.endsWith(".json"))!;
    expect(() => JSON.parse(readFileSync(jsonPath, "utf-8"))).not.toThrow();
  });

  it("同一ラベルの2ソース×同一ターゲットでファイル名を dedup(-2)", async () => {
    const r = req({ targets: ["json"], sourceIds: ["mix0", "mix1"], projectState: projectState(defaultEditState(), "/media/track.mp4", 2) });
    const res = await writeExports(r, realDeps);
    const names = res.written.map((p) => basename(p)).sort();
    expect(names).toEqual(["track_same_markers-2.json", "track_same_markers.json"]);
  });

  it("wavcues: .wav 入力は元バイトを読み cue チャンクを埋め込む", async () => {
    const wavPath = join(HERE, "src.wav");
    writeFileSync(wavPath, silentWav(engine.analysis.durationSec));
    const r = req({ targets: ["wavcues"], projectState: projectState(defaultEditState(), wavPath) });
    const res = await writeExports(r, realDeps);
    expect(res.failed).toEqual([]);
    const out = readFileSync(res.written[0]!);
    expect(out.includes(Buffer.from("cue "))).toBe(true);
  });

  it("wavcues: 動画入力は extractWavForCues で抽出したWAVに埋め込む", async () => {
    const deps: ExportWriterDeps = {
      ...realDeps,
      extractWavForCues: async (_media, dest) => { await writeFile(dest, Buffer.from(silentWav(engine.analysis.durationSec))); },
    };
    const r = req({ targets: ["wavcues"], projectState: projectState(defaultEditState(), "/media/clip.mp4") });
    const res = await writeExports(r, deps);
    expect(res.failed).toEqual([]);
    expect(readFileSync(res.written[0]!).includes(Buffer.from("cue "))).toBe(true);
  });

  it("書込失敗は failed[] に落ち、written は空", async () => {
    const notDir = join(HERE, "afile");
    writeFileSync(notDir, "x");
    const r = req({ targets: ["json"], destDir: notDir }); // ファイルを destDir に → ENOTDIR
    const res = await writeExports(r, realDeps);
    expect(res.written).toEqual([]);
    expect(res.failed).toHaveLength(1);
  });

  it("beatsPerBar=6 → MIDI拍子メタの分母が dd=3(=2^3=8)。ハードコード4禁止(台帳必須)", async () => {
    const edits = { ...defaultEditState(), beatsPerBar: 6 };
    const r = req({ targets: ["midi"], include: ["bar"], projectState: projectState(edits) });
    const res = await writeExports(r, realDeps);
    const mid = readFileSync(res.written[0]!);
    const i = mid.indexOf(Buffer.from([0xff, 0x58, 0x04])); // FF 58 04 nn dd cc bb
    expect(i).toBeGreaterThan(0);
    expect(mid[i + 4]).toBe(6); // nn = beatsPerBar
    expect(mid[i + 5]).toBe(3); // dd = log2(8)
  });
});
```

`app/src/shared/__tests__/exporters-midi-longlabel.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { exportMidi } from "../exporters/midi.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

const enc = new TextEncoder();

function ctx(): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest", include: ["custom"],
    baseName: "x", sourceLabel: null, audioFileName: "x.wav", audioDurationSec: 10,
    bpmLabel: "120.00", keyLabel: "C major (8B)", beatsPerBar: 4, timeSigDenominator: 4,
    tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
  };
}

/** MThd/MTrk を厳密に歩いて構造健全性を確認しつつ、メタ0x06(マーカー)の VLQ 長を集める。 */
function scanMarkerMetaLengths(bytes: Uint8Array): number[] {
  let p = 0;
  const u32 = (o: number) => (bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!;
  expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("MThd");
  const ntrk = (bytes[10]! << 8) | bytes[11]!;
  p = 8 + u32(4);
  const lengths: number[] = [];
  for (let t = 0; t < ntrk; t++) {
    expect(String.fromCharCode(...bytes.slice(p, p + 4))).toBe("MTrk");
    const len = u32(p + 4);
    const end = p + 8 + len;
    let q = p + 8;
    while (q < end) {
      while (bytes[q]! & 0x80) q++; // VLQ delta
      q++;
      const status = bytes[q]!;
      if (status === 0xff) {
        const type = bytes[q + 1]!;
        let r = q + 2, mlen = 0;
        do { mlen = (mlen << 7) | (bytes[r]! & 0x7f); } while (bytes[r++]! & 0x80);
        if (type === 0x06) lengths.push(mlen);
        q = r + mlen;
      } else if (status === 0x90 || status === 0x80) {
        q += 3;
      } else { q += 1; }
    }
    expect(q).toBe(end); // 宣言長ぴったりで消費 = 構造健全
    p = end;
  }
  return lengths;
}

describe("MIDI 長ラベル(>127B)", () => {
  it("150バイトのマーカーラベルは2バイトVLQ長になり、ファイルが構造的に妥当", () => {
    const label = "あ".repeat(50); // 50×3 = 150 バイト(UTF-8)
    expect(enc.encode(label).length).toBe(150);
    const m: Marker = { id: "c1", sourceId: "mix", timeSec: 1, type: "custom", label, color: "#fff", source: "user" };
    const bytes = exportMidi([m], ctx());
    const lens = scanMarkerMetaLengths(bytes);
    expect(lens).toContain(150);       // 長さ=UTF-8バイト数
    // 150 = 0x96 → VLQ [0x81,0x16] の2バイト
    const i = bytes.indexOf(0xff);
    void i;
  });
});
```

`app/src/renderer/__tests__/ExportPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExportPanel } from "../components/ExportPanel.js";

function setup() {
  const dispatch = vi.fn();
  const onExport = vi.fn().mockResolvedValue({ written: [], failed: [] });
  render(<ExportPanel fps={{ num: 30, den: 1 }} rounding="nearest"
    sources={[{ id: "mix", label: "2mix" }, { id: "ch-L", label: "L" }]} activeSourceId="mix"
    dispatch={dispatch} onExport={onExport} />);
  return { dispatch, onExport };
}

describe("ExportPanel", () => {
  it("ターゲット選択・含めるマーカー・書き出しで onExport が正しい形で呼ばれる", async () => {
    const { onExport } = setup();
    fireEvent.click(screen.getByLabelText("target json"));   // 既定OFFのjsonをON
    fireEvent.click(screen.getByLabelText("書き出し"));
    expect(onExport).toHaveBeenCalledTimes(1);
    const arg = onExport.mock.calls[0]![0];
    expect(arg.targets).toContain("json");
    expect(arg.sourceIds).toEqual(["mix"]);          // 既定はアクティブのみ
    expect(typeof arg.includeEnvelopes).toBe("boolean");
  });

  it("fps 変更で FPS_CHANGED、丸め変更で ROUNDING_CHANGED", () => {
    const { dispatch } = setup();
    fireEvent.change(screen.getByLabelText("フレームレート"), { target: { value: "25" } });
    expect(dispatch).toHaveBeenCalledWith({ type: "FPS_CHANGED", fps: { num: 25, den: 1 } });
    fireEvent.change(screen.getByLabelText("丸め"), { target: { value: "floor" } });
    expect(dispatch).toHaveBeenCalledWith({ type: "ROUNDING_CHANGED", rounding: "floor" });
  });

  it("ソース=全てで sourceIds が全ソース", async () => {
    const { onExport } = setup();
    fireEvent.click(screen.getByLabelText("全ソース"));
    fireEvent.click(screen.getByLabelText("target json"));
    fireEvent.click(screen.getByLabelText("書き出し"));
    expect(onExport.mock.calls[0]![0].sourceIds).toEqual(["mix", "ch-L"]);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd /home/claude/beatmarks/app && npx vitest run src/main/__tests__/exportWriter.test.ts src/shared/__tests__/exporters-midi-longlabel.test.ts src/renderer/__tests__/ExportPanel.test.tsx`
Expected: FAIL — `Cannot find module '../exportWriter.js'` / `'../components/ExportPanel.js'`(long-label は exportMidi 既存なので、scan ヘルパの assert が実行され緑になる場合あり。その場合は他2つの FAIL を確認)

- [ ] **Step 4: 実装**

`app/src/main/exportWriter.ts`:

```ts
/** writeExports 本実装(スペック §8)。ソース×ターゲットで ExportContext を組み立て、
 *  共有エクスポータ(計画②)を呼んで実ファイルを書く。fs/ffmpeg は deps 注入(テスト容易)。 */
import { basename, join } from "node:path";

import { deriveMarkers } from "../shared/deriveMarkers.js";
import { embedWavCues } from "../shared/exporters/wavCues.js";
import { runExport } from "../shared/exporters/index.js";
import type { ExportRequest, ProjectFileState, WriteExportsResult } from "../shared/ipc.js";
import { buildFileName, type TargetKey } from "../shared/naming.js";
import { timeSigDenominatorFor, type ExportContext, type TempoPoint } from "../shared/types.js";

export interface ExportWriterDeps {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  /** 動画等の非WAV入力に対し、cue埋め込み用のフルWAVを destPath に抽出する。 */
  extractWavForCues(mediaPath: string, destPath: string): Promise<void>;
  tmpWavPath(): string;
}

type SourceEntry = ProjectFileState["sources"][number];

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

function buildExportContext(req: ExportRequest, s: SourceEntry, multiSource: boolean): ExportContext {
  const { analysis, edits } = s;
  const override =
    edits.bpmOverride !== undefined && Number.isFinite(edits.bpmOverride) && edits.bpmOverride > 0
      ? edits.bpmOverride : undefined;
  const bpmLabel =
    override !== undefined ? override.toFixed(2)
      : analysis.tempoMode === "fixed" && analysis.bpm != null ? analysis.bpm.toFixed(2) : "可変";
  const tempoMap: TempoPoint[] = override !== undefined ? [{ timeSec: 0, bpm: override }] : analysis.tempoMap;
  return {
    fps: req.fps, rounding: req.rounding, include: req.include,
    baseName: req.projectState.baseName,
    sourceLabel: multiSource ? s.source.label : null,
    audioFileName: basename(req.projectState.mediaPath),
    audioDurationSec: req.projectState.durationSec,
    bpmLabel,
    keyLabel: `${analysis.key.global.name} (${analysis.key.global.camelot})`,
    beatsPerBar: edits.beatsPerBar,
    timeSigDenominator: timeSigDenominatorFor(edits.beatsPerBar), // 必須(台帳: ハードコード4禁止)
    tempoMap,
    envelopes: req.includeEnvelopes ? analysis.envelopes : null,
  };
}

/** cue埋め込み用のWAVバイト列。.wav 入力は原品質のコピー、それ以外は ffmpeg 抽出(§8)。 */
async function loadCueWav(mediaPath: string, deps: ExportWriterDeps): Promise<Uint8Array> {
  if (mediaPath.toLowerCase().endsWith(".wav")) return deps.readFile(mediaPath);
  const tmp = deps.tmpWavPath();
  await deps.extractWavForCues(mediaPath, tmp);
  return deps.readFile(tmp);
}

/** naming.ts に dedup が無いため、バッチ内でのファイル名衝突をここで解消する。 */
function dedupe(name: string, used: Set<string>): string {
  if (!used.has(name)) { used.add(name); return name; }
  const dot = name.lastIndexOf(".");
  const stem = dot >= 0 ? name.slice(0, dot) : name;
  const ext = dot >= 0 ? name.slice(dot) : "";
  let i = 2;
  let cand = `${stem}-${i}${ext}`;
  while (used.has(cand)) cand = `${stem}-${++i}${ext}`;
  used.add(cand);
  return cand;
}

export async function writeExports(req: ExportRequest, deps: ExportWriterDeps): Promise<WriteExportsResult> {
  const written: string[] = [];
  const failed: { path: string; message: string }[] = [];
  const used = new Set<string>();

  const sources = req.projectState.sources.filter((s) => req.sourceIds.includes(s.source.id));
  const multiSource = sources.length > 1;

  for (const s of sources) {
    const ctx = buildExportContext(req, s, multiSource);
    const markers = deriveMarkers(s.analysis, s.edits, s.source.id);
    let cueWav: Promise<Uint8Array> | null = null;

    for (const target of req.targets) {
      let fileName: string;
      let data: string | Uint8Array;
      try {
        if (target === "wavcues") {
          if (!cueWav) cueWav = loadCueWav(req.projectState.mediaPath, deps);
          const wavBytes = await cueWav;
          fileName = buildFileName(ctx.baseName, ctx.sourceLabel, "wavcues");
          data = embedWavCues(wavBytes, markers, ctx);
        } else {
          const r = runExport(target as TargetKey, markers, ctx);
          fileName = r.fileName;
          data = r.data;
        }
      } catch (e) {
        failed.push({ path: buildFileName(ctx.baseName, ctx.sourceLabel, target as TargetKey), message: msg(e) });
        continue;
      }
      const full = join(req.destDir, dedupe(fileName, used));
      try {
        await deps.writeFile(full, data);
        written.push(full);
      } catch (e) {
        failed.push({ path: full, message: msg(e) });
      }
    }
  }
  return { written, failed };
}
```

`app/src/main/index.ts` の配線変更:
- import 追加: `import { writeFile } from "node:fs/promises";`(既存の readFile と同じ行にまとめてよい)、`import { extractPlaybackWav, probeMedia } from "./ffmpeg.js";`(probeMedia 既存に extractPlaybackWav を足す)、`import { writeExports } from "./exportWriter.js";`。
- `writeExports` スタブ行を実配線に置換し、`chooseExportDir` を追加:

```ts
    writeExports: (req) =>
      writeExports(req, {
        readFile: async (p) => new Uint8Array(await readFile(p)),
        writeFile: (p, d) => writeFile(p, typeof d === "string" ? d : Buffer.from(d)),
        // 動画入力の cue 埋め込みは 44.1k stereo のフル抽出で代用(先頭音声トラック)。
        // 元 InputConfig.trackIndexes は .bmk に無いため [0] 既定(§8の位置ズレ回避目的は満たす)。
        extractWavForCues: (media, dest) => extractPlaybackWav(media, [0], dest),
        tmpWavPath: () => join(tempDir(), `cues-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`),
      }),
    chooseExportDir: async () => {
      const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
```

`app/src/renderer/state/projectFile.ts`:

```ts
/** EditorProject → .bmk 永続形(ProjectFileState)。保存と書き出しで共用。 */
import type { ProjectFileState } from "../../shared/ipc.js";
import type { EditorProject } from "./store.js";

export function toProjectFileState(p: EditorProject): ProjectFileState {
  return {
    version: 1,
    mediaPath: p.mediaPath, mediaHash: p.mediaHash, baseName: p.baseName,
    playbackWavPath: p.playbackWavPath, durationSec: p.durationSec,
    sources: p.sources.map((s) => ({ source: s.source, analysis: s.analysis, edits: s.edits })),
    activeSourceId: p.activeSourceId,
    ui: { fps: p.fps, rounding: p.rounding },
  };
}
```

> 注: T11 で `ProjectFileState.playbackWavPath` を削除するため、この関数からも当該行を落とす。

`app/src/renderer/state/exportFlow.ts`:

```ts
/** 書き出しフロー: 保存先ダイアログ → writeExports IPC。UIから注入して使う。 */
import type { ExportRequest, WriteExportsResult } from "../../shared/ipc.js";
import type { MarkerType } from "../../shared/types.js";
import type { TargetKey } from "../../shared/naming.js";
import type { EditorProject } from "./store.js";
import { toProjectFileState } from "./projectFile.js";

export interface ExportOpts {
  targets: TargetKey[];
  sourceIds: string[];
  include: MarkerType[];
  includeEnvelopes: boolean;
}

export interface ExportApi {
  chooseExportDir(): Promise<string | null>;
  writeExports(req: ExportRequest): Promise<WriteExportsResult>;
}

/** null = ユーザーが保存先ダイアログをキャンセル。 */
export async function runExportFlow(
  opts: ExportOpts, project: EditorProject, api: ExportApi,
): Promise<WriteExportsResult | null> {
  const destDir = await api.chooseExportDir();
  if (!destDir) return null;
  return api.writeExports({
    ...opts, fps: project.fps, rounding: project.rounding, destDir,
    projectState: toProjectFileState(project),
  });
}
```

`app/src/renderer/components/ExportPanel.tsx`:

```tsx
/** 書き出しパネル(モック .export 準拠、スペック §7/§8/§9)。ターゲット/含めるマーカー/
 *  fps/丸め/ソースを選び onExport に払い出す。結果表示と失敗リトライを内包。 */
import React, { useState } from "react";

import type { WriteExportsResult } from "../../shared/ipc.js";
import type { Fps, MarkerType, RoundingMode } from "../../shared/types.js";
import { TARGETS, type TargetKey } from "../../shared/naming.js";
import { FPS_PRESETS, fpsLabel } from "../../shared/timebase.js";
import type { Action } from "../state/store.js";
import type { ExportOpts } from "../state/exportFlow.js";

const ACTIVE_TARGETS: TargetKey[] = [
  "aejsx", "premiere", "resolve", "blender", "json", "csv", "midi", "wavcues", "reaper", "nuendo", "audacity",
];
const PHASE2 = ["C4D", "Houdini", "Maya / Max", "Unity", "Unreal"];
const INCLUDE_TYPES: MarkerType[] = ["section", "bar", "beat", "hit", "silence", "custom"];
const TYPE_JA: Record<MarkerType, string> = {
  section: "セクション", bar: "小節", beat: "拍", hit: "ヒット", silence: "静寂", custom: "手動",
};
const CUSTOM = "カスタム…";

interface ExportPanelProps {
  fps: Fps;
  rounding: RoundingMode;
  sources: { id: string; label: string }[];
  activeSourceId: string;
  dispatch: (a: Action) => void;
  onExport: (opts: ExportOpts) => Promise<WriteExportsResult | null>;
}

export function ExportPanel(props: ExportPanelProps): React.JSX.Element {
  const { fps, rounding, sources, activeSourceId, dispatch, onExport } = props;
  const [targets, setTargets] = useState<Set<TargetKey>>(new Set(["aejsx", "resolve"]));
  const [include, setInclude] = useState<Set<MarkerType>>(new Set(["section", "bar", "hit", "custom"]));
  const [envelopes, setEnvelopes] = useState(true);
  const [allSources, setAllSources] = useState(false);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WriteExportsResult | null>(null);

  const fpsKey = custom ? CUSTOM : fpsLabel(fps);
  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); return n;
  };

  function onFpsSelect(v: string): void {
    if (v === CUSTOM) { setCustom(true); return; }
    setCustom(false);
    const preset = FPS_PRESETS[v];
    if (preset) dispatch({ type: "FPS_CHANGED", fps: preset });
  }
  function onCustomFps(num: number, den: number): void {
    if (Number.isInteger(num) && Number.isInteger(den) && num > 0 && den > 0) {
      dispatch({ type: "FPS_CHANGED", fps: { num, den } });
    }
  }

  const currentOpts = (): ExportOpts => ({
    targets: [...targets], includeEnvelopes: envelopes, include: [...include],
    sourceIds: allSources ? sources.map((s) => s.id) : [activeSourceId],
  });

  async function doExport(): Promise<void> {
    if (targets.size === 0) return;
    setBusy(true);
    try { setResult(await onExport(currentOpts())); }
    finally { setBusy(false); }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.title}>書き出し</div>
      <div style={styles.body}>
        <div style={styles.row}>
          <label style={styles.label}>フレームレート</label>
          <select aria-label="フレームレート" value={fpsKey} style={styles.select} onChange={(e) => onFpsSelect(e.target.value)}>
            {Object.keys(FPS_PRESETS).map((k) => <option key={k} value={k}>{k}</option>)}
            <option value={CUSTOM}>{CUSTOM}</option>
          </select>
          {custom && (
            <span>
              <input aria-label="fps分子" type="number" defaultValue={fps.num} style={styles.num}
                onChange={(e) => onCustomFps(Number(e.target.value), fps.den)} /> /
              <input aria-label="fps分母" type="number" defaultValue={fps.den} style={styles.num}
                onChange={(e) => onCustomFps(fps.num, Number(e.target.value))} />
            </span>
          )}
          <label style={styles.label}>丸め</label>
          <select aria-label="丸め" value={rounding} style={styles.select}
            onChange={(e) => dispatch({ type: "ROUNDING_CHANGED", rounding: e.target.value as RoundingMode })}>
            <option value="nearest">最近傍</option>
            <option value="floor">切り捨て</option>
          </select>
        </div>

        <div style={styles.row}>
          <label style={{ width: "100%" }}>含めるマーカー:</label>
          <div style={styles.checks}>
            {INCLUDE_TYPES.map((t) => (
              <label key={t} style={styles.check}>
                <input type="checkbox" checked={include.has(t)} onChange={() => setInclude((s) => toggle(s, t))} />{TYPE_JA[t]}
              </label>
            ))}
            <label style={styles.check}>
              <input type="checkbox" checked={envelopes} onChange={(e) => setEnvelopes(e.target.checked)} />エンベロープ
            </label>
          </div>
        </div>

        <div style={styles.row}>
          <label style={{ width: "100%" }}>対象ソース:</label>
          <label style={styles.check}>
            <input aria-label="アクティブソース" type="radio" checked={!allSources} onChange={() => setAllSources(false)} />アクティブのみ
          </label>
          <label style={styles.check}>
            <input aria-label="全ソース" type="radio" checked={allSources} onChange={() => setAllSources(true)} />全ソース（{sources.length}）
          </label>
        </div>

        <div style={styles.row}><label style={{ width: "100%" }}>書き出し先（複数可）:</label></div>
        <div style={styles.targets}>
          {ACTIVE_TARGETS.map((k) => (
            <div key={k} role="button" aria-label={`target ${k}`}
              onClick={() => setTargets((s) => toggle(s, k))}
              style={targets.has(k) ? styles.targetOn : styles.target}>
              <b>{TARGETS[k].label}</b><small style={styles.small}>{TARGETS[k].abbr}.{TARGETS[k].ext}</small>
            </div>
          ))}
          {PHASE2.map((name) => (
            <div key={name} style={styles.targetP2}><b>{name}</b><small style={styles.small}>Phase2</small></div>
          ))}
        </div>

        {result && (
          <div style={styles.result}>
            <div style={{ color: "#7ddc9a" }}>成功 {result.written.length} 件</div>
            {result.failed.length > 0 && (
              <div style={{ color: "#ff4d6b" }}>
                失敗 {result.failed.length} 件
                {result.failed.map((f) => <div key={f.path} style={styles.small}>{f.path}: {f.message}</div>)}
                <button onClick={() => void doExport()}>再試行</button>
              </div>
            )}
          </div>
        )}
      </div>
      <div style={styles.foot}>
        <button aria-label="書き出し" disabled={busy || targets.size === 0} style={styles.primary} onClick={() => void doExport()}>
          {busy ? "書き出し中…" : `⬇ 書き出し（${targets.size}ファイル）`}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { flex: "none", width: 330, display: "flex", flexDirection: "column" },
  title: { flex: "none", padding: "8px 12px", fontWeight: 700, fontSize: 12, borderBottom: "1px solid #262c36" },
  body: { flex: 1, overflow: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  label: { color: "#8b94a3", fontSize: 11 },
  select: { background: "#1f242d", color: "#e8ebf0", border: "1px solid #262c36", borderRadius: 6, padding: "4px 6px", fontSize: 11 },
  num: { width: 52, background: "#1f242d", color: "#e8ebf0", border: "1px solid #262c36", borderRadius: 6, padding: "2px 4px" },
  checks: { display: "flex", gap: 10, flexWrap: "wrap" },
  check: { display: "flex", gap: 4, alignItems: "center", fontSize: 11, cursor: "pointer" },
  targets: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 },
  target: { border: "1px solid #262c36", background: "#191d24", borderRadius: 8, padding: "7px 4px", textAlign: "center", cursor: "pointer" },
  targetOn: { border: "1px solid #ff4d6b", background: "#241a20", borderRadius: 8, padding: "7px 4px", textAlign: "center", cursor: "pointer" },
  targetP2: { border: "1px solid #262c36", background: "#191d24", borderRadius: 8, padding: "7px 4px", textAlign: "center", opacity: 0.42 },
  small: { display: "block", color: "#5a6272", fontSize: 9 },
  result: { fontSize: 11, borderTop: "1px solid #262c36", paddingTop: 8 },
  foot: { flex: "none", padding: "10px 12px", borderTop: "1px solid #262c36" },
  primary: { width: "100%", padding: 9, fontSize: 13, background: "#ff4d6b", border: "1px solid #ff4d6b", color: "#fff", fontWeight: 700, borderRadius: 6, cursor: "pointer" },
};
```

> リトライ簡略化(§9差分): 失敗リトライは同一 opts の再実行(成功済みは冪等上書き)。§9の「失敗分のみ再送」は path→target 逆引きが dedup/多ソースで不確実なため MVP では全再実行とする。保存先変更は再度ダイアログが開くため実質カバーされる。

- [ ] **Step 5: テスト・ビルド確認**

Run: `cd /home/claude/beatmarks/app && npx vitest run && npx tsc --noEmit && npx tsc -p tsconfig.node.json --noEmit && npx electron-vite build 2>&1 | tail -3`
Expected: 全 vitest 緑(本タスク追加分 ~13件)、typecheck OK、ビルド成功

- [ ] **Step 6: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/ipc.ts app/src/main/ipcRegistry.ts app/src/main/index.ts app/src/preload/index.ts \
  app/src/main/exportWriter.ts app/src/renderer/state/projectFile.ts app/src/renderer/state/exportFlow.ts \
  app/src/renderer/components/ExportPanel.tsx app/src/main/__tests__/exportWriter.test.ts \
  app/src/shared/__tests__/exporters-midi-longlabel.test.ts app/src/renderer/__tests__/ExportPanel.test.tsx \
  app/src/main/__tests__/ipcRegistry-cancel.test.ts
git commit -m "feat(app): 書き出しパネルとwriteExports本実装(ExportContext組立・cue埋込・命名衝突回避)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SR5fj8BNeN6TUFgoj4zhm6"
```

---
### Task 11: .bmk改訂+メニュー統合+再オープン

> 台帳ハンドオフの中核: .bmk から揮発 wav パスを落として mediaPath から再抽出+mediaHash 差し替え検知、validateProjectFile 深化(parseEngineResult 再利用)。

**Files:**
- Modify: `app/src/shared/ipc.ts`(`ProjectFileState` から `playbackWavPath` 削除・`OpenProjectOutcome`/`MenuEvent`・`openProjectByPath`・`onMenu`・`IPC_EVENTS.menu`)
- Modify: `app/src/main/projectStore.ts`(deep validation、`parseEngineResult` 再利用)
- Modify: `app/src/main/index.ts`(menu 配線・open フロー・recent)
- Modify: `app/src/main/ipcRegistry.ts`(`openProject` 戻り値型・`openProjectByPath`)
- Modify: `app/src/preload/index.ts`(`onMenu`・`openProjectByPath`)
- Modify: `app/src/renderer/ipc.ts`(Bridge に `onMenu`)
- Modify: `app/src/renderer/state/store.ts`(`isDirty`/`projectPath`・`SAVED`・`PROJECT_LOADED` 改訂)
- Modify: `app/src/renderer/state/projectFile.ts`(`playbackWavPath` を落とす)
- Modify: `app/src/main/__tests__/projectStore.test.ts`(fixture の `playbackWavPath` 行削除)
- Modify: `app/src/main/__tests__/ipcRegistry-cancel.test.ts`(`MainDeps` の `openProjectByPath` 必須化に追随)
- Modify: `app/src/main/__tests__/exportWriter.test.ts`(T10 作成。`projectState()` の `playbackWavPath` 行を削除)
- Create: `app/src/main/openProject.ts`、`app/src/main/recent.ts`、`app/src/main/menu.ts`、`app/src/renderer/hooks/useProjectFile.ts`
- Test: `projectStoreValidate.test.ts`、`openProject.test.ts`、`recent.test.ts`、`menu.test.ts`、`app/src/renderer/__tests__/dirty.test.ts`

**Interfaces:**
- Produces(ipc.ts):
```ts
// ProjectFileState から playbackWavPath を削除(spec §6)。version は 1 のまま。
//   ③aの .bmk は本セッション内のみ・未配布 → migrate は「余剰キー無視」で足りる(validate は既知キーのみ検査)。
export type OpenProjectOutcome =
  | { ok: true; path: string; state: ProjectFileState; playbackWavPath: string; hashMismatch: boolean }
  | { ok: false; message: string };
export type MenuEvent =
  | { action: "open" | "save" | "saveAs" | "undo" | "redo" }
  | { action: "openRecent"; path: string };
// IpcApi: openProject(): Promise<OpenProjectOutcome | null>;
//         openProjectByPath(path: string): Promise<OpenProjectOutcome>;
// Bridge(renderer/preload): onMenu(cb: (ev: MenuEvent) => void): () => void;
```
- Produces(main): `openProjectFlow(path, deps)`(deps 注入で純ロジック化)、`buildMenuTemplate(handlers, recent)`(Electron 非依存の純テンプレート)、`loadRecent`/`addRecent`。
- Consumes: `parseEngineResult`(`shared/validate.js`、analysis 部分木の検証に再利用)。
- store 追加: editor フェーズに `isDirty: boolean`/`projectPath: string | null`、`{ type:"SAVED"; path:string }`、`PROJECT_LOADED` を `{ state; path; playbackWavPath }` に改訂。

- [ ] **Step 1: 失敗するテストを書く**

`app/src/main/__tests__/projectStoreValidate.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { validateProjectFile } from "../projectStore.js";
import { defaultEditState, parseEngineResult } from "../../shared/validate.js";

const engine = parseEngineResult(
  readFileSync(join(__dirname, "..", "..", "shared", "__fixtures__", "analysis-30s.json"), "utf-8"),
);
function valid(): Record<string, unknown> {
  return {
    version: 1, mediaPath: "/m/t.mp4", mediaHash: "a".repeat(64), baseName: "t", durationSec: 30,
    sources: [{ source: { id: "mix", kind: "mix", label: "2mix" }, analysis: engine.analysis, edits: defaultEditState() }],
    activeSourceId: "mix", ui: { fps: { num: 30, den: 1 }, rounding: "nearest" },
  };
}

describe("validateProjectFile 深化", () => {
  it("正常形は通る(playbackWavPath 不要)", () => {
    expect(() => validateProjectFile(valid())).not.toThrow();
  });
  it("edits.hitThreshold 欠落を検出", () => {
    const v = valid();
    (v["sources"] as any)[0].edits = { ...defaultEditState(), hitThreshold: undefined };
    expect(() => validateProjectFile(v)).toThrow(/hitThreshold/);
  });
  it("analysis 部分木の不正(durationSec 欠落)を parseEngineResult 経由で検出", () => {
    const v = valid();
    (v["sources"] as any)[0].analysis = { ...engine.analysis, durationSec: "x" };
    expect(() => validateProjectFile(v)).toThrow(/analysis/);
  });
  it("source.kind 不正を検出", () => {
    const v = valid();
    (v["sources"] as any)[0].source.kind = "bogus";
    expect(() => validateProjectFile(v)).toThrow(/source/);
  });
  it("ui.fps 非整数/0 を検出", () => {
    const v = valid();
    (v["ui"] as any).fps = { num: 0, den: 1 };
    expect(() => validateProjectFile(v)).toThrow(/fps/);
  });
  it("ui.rounding 列挙外を検出", () => {
    const v = valid();
    (v["ui"] as any).rounding = "round";
    expect(() => validateProjectFile(v)).toThrow(/rounding/);
  });
});
```

`app/src/main/__tests__/openProject.test.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { openProjectFlow, type OpenProjectDeps } from "../openProject.js";
import type { ProjectFileState } from "../../shared/ipc.js";
import { defaultEditState, parseEngineResult } from "../../shared/validate.js";

const engine = parseEngineResult(
  readFileSync(join(__dirname, "..", "..", "shared", "__fixtures__", "analysis-30s.json"), "utf-8"),
);
const dir = mkdtempSync(join(tmpdir(), "bmopen-"));
function state(hash: string): ProjectFileState {
  return {
    version: 1, mediaPath: "/m/t.mp4", mediaHash: hash, baseName: "t", durationSec: 30,
    sources: [{ source: { id: "mix", kind: "mix", label: "2mix" }, analysis: engine.analysis, edits: defaultEditState() }],
    activeSourceId: "mix", ui: { fps: { num: 30, den: 1 }, rounding: "nearest" },
  };
}
function deps(over: Partial<OpenProjectDeps> = {}): OpenProjectDeps {
  return {
    readProject: async () => state("HASH"),
    exists: () => true,
    extractPlaybackWav: async (_m, _t, out) => writeFileSync(out, "wavbytes"),
    hashFile: async () => "HASH",
    jobDir: () => dir,
    ...over,
  };
}

describe("openProjectFlow", () => {
  it("ハッシュ一致で ok:true, hashMismatch:false, playbackWavPath 返却", async () => {
    const r = await openProjectFlow("/p.bmk", deps());
    expect(r).toMatchObject({ ok: true, hashMismatch: false, path: "/p.bmk" });
    if (r.ok) expect(r.playbackWavPath.endsWith("playback.wav")).toBe(true);
  });
  it("ハッシュ不一致でも ok:true・hashMismatch:true(続行判断はrenderer)", async () => {
    const r = await openProjectFlow("/p.bmk", deps({ hashFile: async () => "DIFFERENT" }));
    expect(r).toMatchObject({ ok: true, hashMismatch: true });
  });
  it("mediaPath 不在は ok:false", async () => {
    const r = await openProjectFlow("/p.bmk", deps({ exists: () => false }));
    expect(r.ok).toBe(false);
  });
  it("読込失敗は ok:false", async () => {
    const r = await openProjectFlow("/p.bmk", deps({ readProject: async () => { throw new Error("bad"); } }));
    expect(r).toMatchObject({ ok: false });
  });
  it("実ffmpeg: 生成wavを再抽出しハッシュ照合(改ざんで mismatch)", async () => {
    const { extractPlaybackWav } = await import("../ffmpeg.js");
    const media = join(dir, "silence.wav");
    // ffmpeg で 1秒の無音WAVを媒体として用意
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "1", media]);
    const hashFile = async (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
    const real: OpenProjectDeps = {
      readProject: async () => ({ ...state(""), mediaPath: media }),
      exists: () => true, extractPlaybackWav, hashFile, jobDir: () => dir,
    };
    const first = await openProjectFlow("/p.bmk", real);
    if (!first.ok) throw new Error("expected ok");
    const good = await hashFile(first.playbackWavPath);
    const okRun = await openProjectFlow("/p.bmk", { ...real, readProject: async () => ({ ...state(good), mediaPath: media }) });
    expect(okRun).toMatchObject({ ok: true, hashMismatch: false });
    const badRun = await openProjectFlow("/p.bmk", { ...real, readProject: async () => ({ ...state("00"), mediaPath: media }) });
    expect(badRun).toMatchObject({ ok: true, hashMismatch: true });
  });
});
```

`app/src/main/__tests__/recent.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { addRecent, loadRecent } from "../recent.js";

describe("recent", () => {
  it("最大5件・新しい順・重複排除でラウンドトリップ", () => {
    const d = mkdtempSync(join(tmpdir(), "bmrecent-"));
    expect(loadRecent(d)).toEqual([]);
    for (let i = 1; i <= 6; i++) addRecent(d, `/p${i}.bmk`);
    const list = addRecent(d, "/p3.bmk"); // 既存を先頭へ
    expect(list[0]).toBe("/p3.bmk");
    expect(list).toHaveLength(5);
    expect(list).not.toContain("/p1.bmk"); // 溢れて脱落
    expect(loadRecent(d)).toEqual(list);
  });
});
```

`app/src/main/__tests__/menu.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { buildMenuTemplate, type MenuHandlers } from "../menu.js";

function handlers(): MenuHandlers {
  return { onOpen: vi.fn(), onSave: vi.fn(), onSaveAs: vi.fn(), onOpenRecent: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn() };
}
function labels(t: any[]): string[] { return t.map((x) => x.label).filter(Boolean); }

describe("buildMenuTemplate", () => {
  it("ファイル/編集メニューとアクセラレータを持つ", () => {
    const t = buildMenuTemplate(handlers(), []);
    expect(labels(t)).toContain("ファイル");
    expect(labels(t)).toContain("編集");
    const file = t.find((x) => x.label === "ファイル")!.submenu as any[];
    const save = file.find((x) => x.label === "保存");
    expect(save.accelerator).toBe("CmdOrCtrl+S");
    const saveAs = file.find((x) => x.label === "別名で保存…");
    expect(saveAs.accelerator).toBe("CmdOrCtrl+Shift+S");
  });
  it("recent 空は無効プレースホルダ、非空は最大5件", () => {
    const empty = buildMenuTemplate(handlers(), []);
    const fileE = empty.find((x) => x.label === "ファイル")!.submenu as any[];
    const recentE = fileE.find((x) => x.label === "最近使ったファイル")!.submenu as any[];
    expect(recentE).toHaveLength(1);
    expect(recentE[0].enabled).toBe(false);
    const full = buildMenuTemplate(handlers(), ["/a", "/b", "/c", "/d", "/e", "/f"]);
    const fileF = full.find((x) => x.label === "ファイル")!.submenu as any[];
    const recentF = fileF.find((x) => x.label === "最近使ったファイル")!.submenu as any[];
    expect(recentF.length).toBeLessThanOrEqual(5);
  });
  it("保存クリックで onSave が呼ばれる", () => {
    const h = handlers();
    const t = buildMenuTemplate(h, []);
    const file = t.find((x) => x.label === "ファイル")!.submenu as any[];
    (file.find((x) => x.label === "保存")!.click as any)();
    expect(h.onSave).toHaveBeenCalled();
  });
});
```

`app/src/renderer/__tests__/dirty.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { AnalyzedProject } from "../../shared/ipc.js";
import type { AnalysisResult } from "../../shared/types.js";
import { initialState, reducer, type AppState } from "../state/store.js";

function analysis(): AnalysisResult {
  return {
    durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25, beats: [0.25], downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [], hits: [], silences: [], envelopes: { sampleRateHz: 100, total: Array(1000).fill(0.5), low: [], mid: [], high: [] },
  };
}
function proj(): AnalyzedProject {
  return { mediaPath: "/m/t.mp4", mediaHash: "h".repeat(64), baseName: "t", playbackWavPath: "/tmp/p.wav", durationSec: 10,
    sources: [{ source: { id: "mix", kind: "mix", label: "2mix" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/a.wav" }] };
}
function dirty(s: AppState): boolean { if (s.phase !== "editor") throw new Error("x"); return s.isDirty; }

describe("dirty フラグ", () => {
  it("PROJECT_READY は clean、編集で dirty、SAVED で clean", () => {
    let s = reducer(initialState(), { type: "PROJECT_READY", project: proj() });
    expect(dirty(s)).toBe(false);
    s = reducer(s, { type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.01 } });
    expect(dirty(s)).toBe(true);
    s = reducer(s, { type: "SAVED", path: "/x.bmk" });
    expect(dirty(s)).toBe(false);
    if (s.phase === "editor") expect(s.projectPath).toBe("/x.bmk");
  });
  it("MARKER_SELECTED は dirty を変えない", () => {
    let s = reducer(initialState(), { type: "PROJECT_READY", project: proj() });
    s = reducer(s, { type: "MARKER_SELECTED", markerId: "beat-0" });
    expect(dirty(s)).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /home/claude/beatmarks/app && npx vitest run src/main/__tests__/openProject.test.ts src/main/__tests__/recent.test.ts src/main/__tests__/menu.test.ts src/renderer/__tests__/dirty.test.ts`
Expected: FAIL — 新規モジュール未作成、`isDirty`/`SAVED` 未定義

- [ ] **Step 3: shared/ipc.ts を改訂**

- `ProjectFileState` から `playbackWavPath: string;` の行を削除。`ui.rounding` は `RoundingMode` を使ってよい(import 済みなら)。
- `IPC_CHANNELS` に追加: `openProjectByPath: "bm:openProjectByPath",`。
- `IPC_EVENTS` に追加: `menu: "bm:menu",`。
- 型追加:

```ts
export type OpenProjectOutcome =
  | { ok: true; path: string; state: ProjectFileState; playbackWavPath: string; hashMismatch: boolean }
  | { ok: false; message: string };

export type MenuEvent =
  | { action: "open" | "save" | "saveAs" | "undo" | "redo" }
  | { action: "openRecent"; path: string };
```

- `IpcApi` の `openProject` を差し替え、`openProjectByPath` を追加:

```ts
  openProject(): Promise<OpenProjectOutcome | null>;
  openProjectByPath(path: string): Promise<OpenProjectOutcome>;
```

- [ ] **Step 4: projectStore.ts を深化**

`app/src/main/projectStore.ts`(先頭の import に追加 → `import { parseEngineResult } from "../shared/validate.js";`)。`validateProjectFile` を差し替え、検証ヘルパを追加:

```ts
function isNum(x: unknown): x is number { return typeof x === "number" && Number.isFinite(x); }
function isInt(x: unknown): x is number { return isNum(x) && Number.isInteger(x); }

function validateAnalysis(a: unknown, path: string): void {
  try { parseEngineResult(JSON.stringify({ analysis: a, warnings: [] })); }
  catch (e) { throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`); }
}

function validateEditState(raw: unknown, path: string): void {
  if (typeof raw !== "object" || raw === null) throw new Error(`${path} が不正です`);
  const e = raw as Record<string, unknown>;
  if (!isNum(e["gridOffsetDeltaSec"])) throw new Error(`${path}.gridOffsetDeltaSec が不正です`);
  if (!isNum(e["beatsPerBar"])) throw new Error(`${path}.beatsPerBar が不正です`);
  if (!isNum(e["downbeatShift"])) throw new Error(`${path}.downbeatShift が不正です`);
  if (e["bpmOverride"] !== undefined && !isNum(e["bpmOverride"])) throw new Error(`${path}.bpmOverride が不正です`);
  const anchor = e["gridAnchor"];
  if (anchor !== undefined) {
    const a = anchor as Record<string, unknown>;
    if (typeof anchor !== "object" || anchor === null || !isNum(a["timeSec"]) || typeof a["freeBefore"] !== "boolean") {
      throw new Error(`${path}.gridAnchor が不正です`);
    }
  }
  const ht = e["hitThreshold"] as Record<string, unknown> | undefined;
  if (!ht || typeof ht !== "object" || !isNum(ht["low"]) || !isNum(ht["mid"]) || !isNum(ht["high"])) {
    throw new Error(`${path}.hitThreshold が不正です`);
  }
  const st = e["silenceThreshold"] as Record<string, unknown> | undefined;
  if (!st || typeof st !== "object" || !isNum(st["db"]) || !isNum(st["minDurSec"])) {
    throw new Error(`${path}.silenceThreshold が不正です`);
  }
  for (const k of ["sectionEdits", "customMarkers", "deletedMarkerIds"]) {
    if (!Array.isArray(e[k])) throw new Error(`${path}.${k} が不正です`);
  }
}

function validateSource(raw: unknown, i: number): void {
  const path = `sources[${i}]`;
  if (typeof raw !== "object" || raw === null) throw new Error(`${path} が不正です`);
  const s = raw as Record<string, unknown>;
  const src = s["source"] as Record<string, unknown> | undefined;
  if (!src || typeof src !== "object" || typeof src["id"] !== "string" ||
      (src["kind"] !== "mix" && src["kind"] !== "track" && src["kind"] !== "channel") ||
      typeof src["label"] !== "string") {
    throw new Error(`${path}.source が不正です`);
  }
  validateAnalysis(s["analysis"], `${path}.analysis`);
  validateEditState(s["edits"], `${path}.edits`);
}

export function validateProjectFile(raw: unknown): ProjectFileState {
  if (typeof raw !== "object" || raw === null) throw new Error(".bmk の形式が不正です");
  const o = raw as Record<string, unknown>;
  if (o["version"] !== 1) throw new Error(`未対応の .bmk version: ${String(o["version"])}(対応: 1)`);
  for (const key of ["mediaPath", "mediaHash", "baseName", "activeSourceId"]) {
    if (typeof o[key] !== "string") throw new Error(`.bmk の ${key} が不正です`);
  }
  if (typeof o["durationSec"] !== "number") throw new Error(".bmk の durationSec が不正です");
  if (!Array.isArray(o["sources"])) throw new Error(".bmk の sources が不正です");
  (o["sources"] as unknown[]).forEach(validateSource);
  const ui = o["ui"] as Record<string, unknown> | undefined;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) throw new Error(".bmk の ui が不正です");
  const fps = ui["fps"] as Record<string, unknown> | undefined;
  if (!fps || !isInt(fps["num"]) || !isInt(fps["den"]) || (fps["num"] as number) <= 0 || (fps["den"] as number) <= 0) {
    throw new Error(".bmk の ui.fps が不正です");
  }
  if (ui["rounding"] !== "nearest" && ui["rounding"] !== "floor") throw new Error(".bmk の ui.rounding が不正です");
  return raw as ProjectFileState;
}
```

`app/src/main/__tests__/projectStore.test.ts` の fixture から `playbackWavPath: "/tmp/playback.wav",` の行を削除(型から消えたため)。

- [ ] **Step 5: openProject / recent / menu を実装**

`app/src/main/openProject.ts`:

```ts
/** .bmk 再オープンのオーケストレーション(spec §6)。playbackWav は永続化せず
 *  mediaPath から再抽出し、mediaHash で差し替えを検知する。fs/ffmpeg は deps 注入。 */
import { join } from "node:path";

import type { OpenProjectOutcome, ProjectFileState } from "../shared/ipc.js";

export interface OpenProjectDeps {
  readProject(path: string): Promise<ProjectFileState>;   // = openProjectFrom(path).state(deep validate 済み)
  exists(path: string): boolean;
  extractPlaybackWav(mediaPath: string, trackIndexes: number[], outPath: string): Promise<void>;
  hashFile(path: string): Promise<string>;
  jobDir(): string;
}

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

export async function openProjectFlow(path: string, deps: OpenProjectDeps): Promise<OpenProjectOutcome> {
  let state: ProjectFileState;
  try { state = await deps.readProject(path); }
  catch (e) { return { ok: false, message: `プロジェクトを開けません: ${msg(e)}` }; }
  if (!deps.exists(state.mediaPath)) {
    return { ok: false, message: `元メディアが見つかりません: ${state.mediaPath}` };
  }
  const outPath = join(deps.jobDir(), "playback.wav");
  try { await deps.extractPlaybackWav(state.mediaPath, [0], outPath); }
  catch (e) { return { ok: false, message: `音声の再抽出に失敗しました: ${msg(e)}` }; }
  // 注: 元 InputConfig.trackIndexes は .bmk 未保存のため [0] で再抽出。多トラック mix 由来の
  // プロジェクトでは hashMismatch が偽陽性になりうる(mediaHash は助言的 — renderer が続行/中止を確認)。
  const hashMismatch = (await deps.hashFile(outPath)) !== state.mediaHash;
  return { ok: true, path, state, playbackWavPath: outPath, hashMismatch };
}
```

`app/src/main/recent.ts`:

```ts
/** 最近使ったファイル(userData/recent.json、最大5件)。新規依存なしの素の JSON。 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MAX = 5;

export function recentPath(userDataDir: string): string { return join(userDataDir, "recent.json"); }

export function loadRecent(userDataDir: string): string[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(recentPath(userDataDir), "utf-8"));
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch { return []; }
}

export function addRecent(userDataDir: string, path: string): string[] {
  const next = [path, ...loadRecent(userDataDir).filter((p) => p !== path)].slice(0, MAX);
  const file = recentPath(userDataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next), "utf-8");
  return next;
}
```

`app/src/main/menu.ts`:

```ts
/** アプリメニューの純テンプレート(Electron 非依存でテスト可能)。配線は index.ts。 */
import type { MenuItemConstructorOptions } from "electron";

export interface MenuHandlers {
  onOpen(): void;
  onSave(): void;
  onSaveAs(): void;
  onOpenRecent(path: string): void;
  onUndo(): void;
  onRedo(): void;
}

export function buildMenuTemplate(h: MenuHandlers, recent: string[]): MenuItemConstructorOptions[] {
  const isMac = process.platform === "darwin";
  const recentSub: MenuItemConstructorOptions[] = recent.length
    ? recent.map((p) => ({ label: p, click: () => h.onOpenRecent(p) }))
    : [{ label: "（履歴なし）", enabled: false }];
  const template: MenuItemConstructorOptions[] = [];
  if (isMac) {
    template.push({ label: "BeatMarks", submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }] });
  }
  template.push({
    label: "ファイル",
    submenu: [
      { label: "開く…", accelerator: "CmdOrCtrl+O", click: () => h.onOpen() },
      { label: "保存", accelerator: "CmdOrCtrl+S", click: () => h.onSave() },
      { label: "別名で保存…", accelerator: "CmdOrCtrl+Shift+S", click: () => h.onSaveAs() },
      { type: "separator" },
      { label: "最近使ったファイル", submenu: recentSub },
      { type: "separator" },
      isMac ? { role: "close" } : { role: "quit" },
    ],
  });
  template.push({
    label: "編集",
    submenu: [
      { label: "取り消し", accelerator: "CmdOrCtrl+Z", click: () => h.onUndo() },
      { label: "やり直し", accelerator: "CmdOrCtrl+Shift+Z", click: () => h.onRedo() },
      { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" },
    ],
  });
  return template;
}
```

- [ ] **Step 6: main/index.ts と ipcRegistry を配線**

`app/src/main/ipcRegistry.ts`: `MainDeps.openProject` を `Promise<OpenProjectOutcome | null>` に変更し、`openProjectByPath(path: string): Promise<OpenProjectOutcome>` を追加。ハンドラに `ipcMain.handle(IPC_CHANNELS.openProjectByPath, (_e, path: string) => deps.openProjectByPath(path));` を追加(import も `OpenProjectOutcome` へ)。

**A の T1 テストへの追随(必須)**: `MainDeps` に `openProjectByPath` を足すため、`app/src/main/__tests__/ipcRegistry-cancel.test.ts` の `deps()` に1行足す(`openProject` の既存 `vi.fn(async () => null)` は `OpenProjectOutcome | null` にそのまま代入可):

```ts
    openProjectByPath: vi.fn(async () => ({ ok: false, message: "n/a" })),   // ← 追加(必須プロパティ)
```

**T10 テストへの追随(必須)**: `ProjectFileState` から `playbackWavPath` を消すため、T10 で作った `app/src/main/__tests__/exportWriter.test.ts` の `projectState()` リテラルから `playbackWavPath: "/tmp/p.wav",` の記述を削除する(残すと余剰プロパティで tsc に落ちる)。

`app/src/main/index.ts`:
- import 追加: `Menu` を electron から、`app`(既存)、`{ openProjectFlow } from "./openProject.js"`、`{ addRecent, loadRecent } from "./recent.js"`、`{ buildMenuTemplate } from "./menu.js"`、`{ createHash } from "node:crypto"`、`{ createReadStream } from "node:fs"`、`{ pipeline } from "node:stream/promises"`、`{ extractPlaybackWav } from "./ffmpeg.js"`(既存 probeMedia に追加)。
- ハッシュユーティリティ:

```ts
async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}
```

- open フロー用 deps ファクトリと menu 配線を `app.whenReady` 内に追加:

```ts
  const openDeps = () => ({
    readProject: async (p: string) => (await openProjectFrom(p)).state,
    exists: existsSync,
    extractPlaybackWav,
    hashFile: sha256File,
    jobDir: () => { const d = join(tempDir(), `open-${Date.now()}`); mkdirSync(d, { recursive: true }); return d; },
  });

  function refreshMenu(): void {
    const recent = loadRecent(app.getPath("userData"));
    const template = buildMenuTemplate({
      onOpen: () => win?.webContents.send(IPC_EVENTS.menu, { action: "open" }),
      onSave: () => win?.webContents.send(IPC_EVENTS.menu, { action: "save" }),
      onSaveAs: () => win?.webContents.send(IPC_EVENTS.menu, { action: "saveAs" }),
      onOpenRecent: (p) => win?.webContents.send(IPC_EVENTS.menu, { action: "openRecent", path: p }),
      onUndo: () => win?.webContents.send(IPC_EVENTS.menu, { action: "undo" }),
      onRedo: () => win?.webContents.send(IPC_EVENTS.menu, { action: "redo" }),
    }, recent);
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
```

`existsSync`/`mkdirSync` を `node:fs` から import すること。`registerHandlers` の該当ハンドラを置換:

```ts
    saveProject: async (state, toPath) => {
      validateProjectFile(state);
      let target = toPath;
      if (!target) {
        const r = await dialog.showSaveDialog({ defaultPath: `${state.baseName}.bmk`, filters: [{ name: "BeatMarks Project", extensions: ["bmk"] }] });
        if (r.canceled || !r.filePath) throw new Error("保存がキャンセルされました");
        target = r.filePath;
      }
      const saved = await saveProjectTo(state, target);
      addRecent(app.getPath("userData"), saved); refreshMenu();
      return saved;
    },
    openProject: async () => {
      const r = await dialog.showOpenDialog({ filters: [{ name: "BeatMarks Project", extensions: ["bmk"] }], properties: ["openFile"] });
      const path = r.filePaths[0];
      if (r.canceled || !path) return null;
      const outcome = await openProjectFlow(path, openDeps());
      if (outcome.ok) { readableRoots.add(outcome.playbackWavPath); addRecent(app.getPath("userData"), path); refreshMenu(); }
      return outcome;
    },
    openProjectByPath: async (path) => {
      const outcome = await openProjectFlow(path, openDeps());
      if (outcome.ok) { readableRoots.add(outcome.playbackWavPath); addRecent(app.getPath("userData"), path); refreshMenu(); }
      return outcome;
    },
```

`createWindow()` の直後に `refreshMenu();` を呼ぶ。

- [ ] **Step 7: renderer の store / projectFile / hook を改訂**

`app/src/renderer/state/projectFile.ts`: `playbackWavPath: p.playbackWavPath,` の行を削除(型から消えたため)。

`app/src/renderer/state/store.ts`(T1 が `selectedMarkerId`/`error` フェーズ済みの前提で):
- editor フェーズ variant に `isDirty: boolean; projectPath: string | null;` を追加。
- `Action` の `PROJECT_LOADED` を差し替え、`SAVED` を追加:

```ts
  | { type: "PROJECT_LOADED"; state: ProjectFileState; path: string; playbackWavPath: string }
  | { type: "SAVED"; path: string }
```

- 上段 switch の break 一覧に `case "SAVED":` を追加(`PROJECT_LOADED` は既に editor を直接返すため上段で処理)。
- `PROJECT_READY` の返り値に `isDirty: false, projectPath: null`(T1 の `selectedMarkerId: null` と並べて)を追加。
- `PROJECT_LOADED` を改訂(`playbackWavPath` は action から取得):

```ts
    case "PROJECT_LOADED": {
      const s = action.state;
      return {
        phase: "editor",
        project: {
          mediaPath: s.mediaPath, mediaHash: s.mediaHash, baseName: s.baseName,
          playbackWavPath: action.playbackWavPath, durationSec: s.durationSec,
          sources: s.sources.map((x) => ({ ...x, warnings: [] })),
          activeSourceId: s.activeSourceId, fps: s.ui.fps, rounding: s.ui.rounding,
        },
        undo: [], redo: [], selectedMarkerId: null, isDirty: false, projectPath: action.path,
      };
    }
```

- dirty を立てる: `withActiveEdits` の返り値に `isDirty: true` を追加。`FPS_CHANGED`/`ROUNDING_CHANGED`/`UNDO`/`REDO` の各返り値にも `isDirty: true` を追加。
- editor 専用 switch に `SAVED` ケースを追加:

```ts
    case "SAVED":
      return { ...state, isDirty: false, projectPath: action.path };
```

> `SOURCE_SWITCHED`/`MARKER_SELECTED` は dirty を変えない(現状維持でよい)。

`app/src/renderer/ipc.ts` の Bridge 型に `onMenu` を追加:

```ts
type Bridge = IpcApi & {
  onAnalyzeProgress(cb: (ev: AnalyzeProgressEvent) => void): () => void;
  onMenu(cb: (ev: MenuEvent) => void): () => void;
};
```
(`MenuEvent` を import に追加。)

`app/src/preload/index.ts` の api に追加:

```ts
  openProjectByPath: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.openProjectByPath, path),
  onMenu: (cb) => {
    const listener = (_e: unknown, ev: import("../shared/ipc.js").MenuEvent) => cb(ev);
    ipcRenderer.on(IPC_EVENTS.menu, listener);
    return () => ipcRenderer.removeListener(IPC_EVENTS.menu, listener);
  },
```
(preload の型宣言 `const api: IpcApi & { onAnalyzeProgress…; onMenu… }` に `onMenu` を足す。)

`app/src/renderer/hooks/useProjectFile.ts`(保存/開く/最近開く/ダーティ・タイトル。undo/redo は T12 が別購読):

```ts
/** メニュー由来のファイル操作(開く/保存/別名/最近)とダーティ・タイトルを配線するフック。
 *  undo/redo のメニューイベントは T12(EditorScreen)がソース横断考慮つきで別途購読する。 */
import { useEffect } from "react";

import type { OpenProjectOutcome } from "../../shared/ipc.js";
import { getIpc } from "../ipc.js";
import type { Action, AppState } from "../state/store.js";
import { toProjectFileState } from "../state/projectFile.js";

const HASH_MISMATCH_MSG =
  "メディアが変更されています。解析結果と波形が一致しない可能性があります。続行しますか？";

export function useProjectFile(state: AppState, dispatch: (a: Action) => void): void {
  useEffect(() => {
    async function save(): Promise<void> {
      if (state.phase !== "editor") return;
      const path = await getIpc().saveProject(toProjectFileState(state.project), state.projectPath);
      dispatch({ type: "SAVED", path });
    }
    async function saveAs(): Promise<void> {
      if (state.phase !== "editor") return;
      const path = await getIpc().saveProject(toProjectFileState(state.project), null);
      dispatch({ type: "SAVED", path });
    }
    function load(outcome: OpenProjectOutcome | null): void {
      if (!outcome) return;
      if (!outcome.ok) { alert(outcome.message); return; }
      if (outcome.hashMismatch && !window.confirm(HASH_MISMATCH_MSG)) return;
      dispatch({ type: "PROJECT_LOADED", state: outcome.state, path: outcome.path, playbackWavPath: outcome.playbackWavPath });
    }
    async function open(): Promise<void> { load(await getIpc().openProject()); }
    async function openPath(p: string): Promise<void> { load(await getIpc().openProjectByPath(p)); }

    return getIpc().onMenu((ev) => {
      if (ev.action === "save") void save();
      else if (ev.action === "saveAs") void saveAs();
      else if (ev.action === "open") void open();
      else if (ev.action === "openRecent") void openPath(ev.path);
      // undo/redo は T12 が処理
    });
  }, [state, dispatch]);

  // タイトル(ダーティは • を付与)
  useEffect(() => {
    document.title = state.phase === "editor"
      ? `${state.project.baseName}${state.isDirty ? " •" : ""} - BeatMarks`
      : "BeatMarks";
  }, [state]);
}
```

> `App.tsx`(T12 で整理)から `useProjectFile(state, dispatch)` をトップレベルで1回呼ぶ。フックはフェーズ非依存に購読するため editor 以外でも安全。

- [ ] **Step 8: テスト・ビルド確認**

Run: `cd /home/claude/beatmarks/app && npx vitest run && npx tsc --noEmit && npx tsc -p tsconfig.node.json --noEmit && npx electron-vite build 2>&1 | tail -3`
Expected: 全 vitest 緑(本タスク追加分 ~19件、既存 projectStore.test.ts も緑)、typecheck OK、ビルド成功

- [ ] **Step 9: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/ipc.ts app/src/main/projectStore.ts app/src/main/openProject.ts \
  app/src/main/recent.ts app/src/main/menu.ts app/src/main/index.ts app/src/main/ipcRegistry.ts \
  app/src/preload/index.ts app/src/renderer/ipc.ts app/src/renderer/state/store.ts \
  app/src/renderer/state/projectFile.ts app/src/renderer/hooks/useProjectFile.ts \
  app/src/main/__tests__/projectStore.test.ts app/src/main/__tests__/projectStoreValidate.test.ts \
  app/src/main/__tests__/openProject.test.ts app/src/main/__tests__/recent.test.ts \
  app/src/main/__tests__/menu.test.ts app/src/renderer/__tests__/dirty.test.ts \
  app/src/main/__tests__/ipcRegistry-cancel.test.ts app/src/main/__tests__/exportWriter.test.ts
git commit -m "feat(app): .bmk改訂(wav再抽出+hash検知)・深い検証・メニュー統合・最近使ったファイル

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SR5fj8BNeN6TUFgoj4zhm6"
```

### Task 12: エディタ統合+ショートカット+仕上げ

> T4-T10 を組み立て、ショートカット・ソースタブ・トースト・仕上げ(抽出インジケータ/stereo-split ゲーティング/防御化)を入れて End-to-End を成立させる。

**Files:**
- Create: `app/src/renderer/editor/keymap.ts`(純: キー→コマンド・シーク・nudge・undo対象ソース)
- Create: `app/src/renderer/editor/inputConfig.ts`(`canStereoSplit`)
- Create: `app/src/renderer/components/Toast.tsx`
- Create: `app/src/renderer/components/EditorScreen.tsx`
- Modify: `app/src/renderer/App.tsx`(EditorScreen 配線・AnalyzeOutcome 分岐・error 画面・抽出インジケータ・stereo-split ゲーティング・防御化・useProjectFile)
- Create: `docs/manual-qa-editor.md`(手動QAチェックリスト ~40行)
- Test: `keymap.test.ts`、`inputConfig.test.ts`、`EditorScreen.test.tsx`

**Interfaces:**
- Consumes(T1): `AnalyzeOutcome`(`{cancelled:false;project}|{cancelled:true}`)、`ANALYZE_FAILED`(action フィールドは `message`)、`error` フェーズ(**A の実装は `{ phase:"error"; errorMessage:string }`** — 画面側は `state.errorMessage` を読む)、`selectedMarkerId`。
- Consumes(T3): `viewStore`(**A の実装名は `ViewStoreProvider` と `useViewStore()`**(=`{ view, dispatch }` を返す単一フック。`ViewProvider`/`useView()`/`useViewDispatch()` は存在しない)、`laneVisibility`(キー: `beatGrid`/`sections`/`hits`/`silence`)、`SET_VIEW`/`TOGGLE_LANE`/`CYCLE_TIME_UNIT`/`SET_SNAP`/`SET_LOOP`/`SET_FOLLOW` アクション)。
- Consumes(T4): `Transport` props `{ playback, grid, fps, onAddMarker(sec), onTapTempo(bpm) }`、`PlaybackEngine`。
- Consumes(T5/T6): `Overview`/`SectionBand`/`WaveCanvas` と `Viewport`/`secToPx`/`pxToSec`。**props は A の実装契約に確定済み**(Step 4 の EditorScreen で配線済み):`Overview`={peaks,sections,durationSec,viewport,playheadSec,onScrubTo}、`SectionBand`={sections,viewport,barIntervalSec,playheadSec,snap,onMoveBoundary,onRename,onDelete,onAddAtPlayhead}、`WaveCanvas`={peaks,grid,markers,anchorSec,playback,sampleRate,onSelectMarker,onAnchorDrag}(scroll/zoom は viewStore 内部購読)。ピーク Worker 起動も EditorScreen が担当(A の T2 契約)。
- Consumes(自作・確定): `GridBar`(T8)/`HitLanes`(T7)/`MarkerTable`(T9)/`ExportPanel`+`runExportFlow`(T10)。
- 判断メモ: `ViewStoreProvider` は EditorScreen 内側に置く(RESET で EditorScreen ごとアンマウント → viewStore もリセット、台帳「RESET が viewStore をクリア」を満たす)。undo/redo はソース横断単一スタックなので、非アクティブソースの取消時はそのタブへ自動切替+トースト(台帳)。

- [ ] **Step 1: 失敗するテストを書く**

`app/src/renderer/__tests__/keymap.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { keyToCommand, nudgeAction, seekTarget, undoTargetSourceId } from "../editor/keymap.js";
import type { GridBeat } from "../../shared/deriveGrid.js";
import type { Marker } from "../../shared/types.js";

function ev(over: Partial<Parameters<typeof keyToCommand>[0]> = {}) {
  return { key: " ", shiftKey: false, metaKey: false, ctrlKey: false, target: null, ...over };
}

describe("keyToCommand", () => {
  it("網羅表", () => {
    expect(keyToCommand(ev({ key: " " }))).toEqual({ kind: "playPause" });
    expect(keyToCommand(ev({ key: "m" }))).toEqual({ kind: "addMarker" });
    expect(keyToCommand(ev({ key: "ArrowLeft" }))).toEqual({ kind: "seek", unit: "beat", dir: -1 });
    expect(keyToCommand(ev({ key: "ArrowRight", shiftKey: true }))).toEqual({ kind: "seek", unit: "bar", dir: 1 });
    expect(keyToCommand(ev({ key: "," }))).toEqual({ kind: "nudge", dir: -1, coarse: false });
    expect(keyToCommand(ev({ key: ".", shiftKey: true }))).toEqual({ kind: "nudge", dir: 1, coarse: true });
    expect(keyToCommand(ev({ key: "1" }))).toEqual({ kind: "toggleLane", lane: "beatGrid" });
    expect(keyToCommand(ev({ key: "4" }))).toEqual({ kind: "toggleLane", lane: "silence" });
    expect(keyToCommand(ev({ key: "z", metaKey: true }))).toEqual({ kind: "undo" });
    expect(keyToCommand(ev({ key: "z", metaKey: true, shiftKey: true }))).toEqual({ kind: "redo" });
  });
  it("入力要素にフォーカス中は無効", () => {
    expect(keyToCommand(ev({ key: "m", target: { tagName: "INPUT" } as unknown as EventTarget }))).toBeNull();
  });
});

describe("seekTarget / nudgeAction / undoTargetSourceId", () => {
  const pts: GridBeat[] = [0, 0.5, 1.0, 1.5].map((t, i) => ({ timeSec: t, index: i, isBar: i % 2 === 0, barNumber: 1, free: false }));
  it("seekTarget: 次/前の格子点", () => {
    expect(seekTarget(pts, 0.6, 1)).toBe(1.0);
    expect(seekTarget(pts, 0.6, -1)).toBe(0.5);
    expect(seekTarget(pts, 2.0, 1)).toBeNull();
  });
  it("nudgeAction: custom→移動 / section→境界移動 / 無選択→gridOffset", () => {
    const cm: Marker = { id: "custom-1", sourceId: "mix", timeSec: 3, type: "custom", label: "x", color: "#fff", source: "user" };
    expect(nudgeAction({ dir: 1, coarse: false }, cm, 0, 5)).toEqual({ type: "CUSTOM_MARKER_UPDATED", id: "custom-1", patch: { timeSec: 3.001 } });
    const sm: Marker = { id: "sec-o2", sourceId: "mix", timeSec: 10, type: "section", label: "A", color: "#fff", source: "auto" };
    expect(nudgeAction({ dir: -1, coarse: true }, sm, 0, 5)).toEqual({ type: "SECTION_EDIT_ADDED", op: { op: "move", index: 2, startSec: 9.99 } });
    expect(nudgeAction({ dir: 1, coarse: false }, null, 0.02, 5)).toEqual({ type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.021 } });
  });
  it("undoTargetSourceId: スタック先頭の sourceId", () => {
    expect(undoTargetSourceId([{ sourceId: "ch-L" }], [], "undo")).toBe("ch-L");
    expect(undoTargetSourceId([], [], "undo")).toBeNull();
  });
});
```

`app/src/renderer/__tests__/inputConfig.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { canStereoSplit } from "../editor/inputConfig.js";

describe("canStereoSplit", () => {
  it("選択にステレオが1つでもあれば true", () => {
    expect(canStereoSplit([0, 1], [2, 1])).toBe(true);
    expect(canStereoSplit([1], [2, 1])).toBe(false);
    expect(canStereoSplit([], [2])).toBe(false);
  });
});
```

`app/src/renderer/__tests__/EditorScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// T5/T6 の重量コンポーネントはスタブ(座標系/Canvasは本テスト対象外)
vi.mock("../components/WaveCanvas.js", () => ({ WaveCanvas: () => null }));
vi.mock("../components/Overview.js", () => ({ Overview: () => null }));
vi.mock("../components/SectionBand.js", () => ({ SectionBand: () => null }));
vi.mock("../components/Transport.js", () => ({ Transport: () => null }));

import { EditorScreen } from "../components/EditorScreen.js";
import { initialState, reducer, type AppState } from "../state/store.js";
import type { AnalyzedProject } from "../../shared/ipc.js";
import type { AnalysisResult } from "../../shared/types.js";
import type { PlaybackEngine } from "../audio/playback.js";

function analysis(): AnalysisResult {
  return {
    durationSec: 10, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25, beats: [0.25, 0.75], downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [{ startSec: 0, endSec: 10, label: "A", clusterId: 0, chorusCandidate: false }],
    hits: [], silences: [], envelopes: { sampleRateHz: 100, total: Array(1000).fill(0.5), low: [], mid: [], high: [] },
  };
}
function proj(): AnalyzedProject {
  return { mediaPath: "/m/t.mp4", mediaHash: "h".repeat(64), baseName: "t", playbackWavPath: "/tmp/p.wav", durationSec: 10,
    sources: [
      { source: { id: "mix", kind: "mix", label: "2mix" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/a.wav" },
      { source: { id: "ch-L", kind: "channel", label: "L" }, analysis: analysis(), warnings: [], analysisWavPath: "/tmp/l.wav" },
    ] };
}
const fakePlayback = { isPlaying: () => false, play: vi.fn(), pause: vi.fn(), seek: vi.fn(), currentTime: () => 5, durationSec: () => 10 } as unknown as PlaybackEngine;

function editorState(): Extract<AppState, { phase: "editor" }> {
  const s = reducer(initialState(), { type: "PROJECT_READY", project: proj() });
  if (s.phase !== "editor") throw new Error("x");
  return s;
}

describe("EditorScreen", () => {
  it("スモーク: マーカーテーブルと書き出しパネルを描画", () => {
    render(<EditorScreen state={editorState()} dispatch={vi.fn()} playback={fakePlayback} />);
    expect(screen.getByText("マーカー一覧")).toBeTruthy();
    expect(screen.getByText("書き出し")).toBeTruthy();
  });

  it("M キーで CUSTOM_MARKER_ADDED(playhead位置)", () => {
    const dispatch = vi.fn();
    render(<EditorScreen state={editorState()} dispatch={dispatch} playback={fakePlayback} />);
    fireEvent.keyDown(window, { key: "m" });
    const call = dispatch.mock.calls.find((c) => c[0].type === "CUSTOM_MARKER_ADDED");
    expect(call).toBeTruthy();
    expect(call![0].marker.timeSec).toBe(5);
    expect(call![0].marker.type).toBe("custom");
  });

  it("非アクティブソースの Undo でタブ自動切替+トースト", () => {
    // undo 先頭を ch-L に、active を mix にした状態を人工的に作る
    let s = editorState();
    s = reducer(s, { type: "SOURCE_SWITCHED", sourceId: "ch-L" });
    s = reducer(s, { type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: 0.01 } }); // undo entry sourceId=ch-L
    s = reducer(s, { type: "SOURCE_SWITCHED", sourceId: "mix" });
    if (s.phase !== "editor") throw new Error("x");
    const dispatch = vi.fn();
    render(<EditorScreen state={s} dispatch={dispatch} playback={fakePlayback} />);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(dispatch).toHaveBeenCalledWith({ type: "SOURCE_SWITCHED", sourceId: "ch-L" });
    expect(dispatch).toHaveBeenCalledWith({ type: "UNDO" });
    expect(screen.getByRole("status").textContent).toContain("別ソース");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /home/claude/beatmarks/app && npx vitest run src/renderer/__tests__/keymap.test.ts src/renderer/__tests__/inputConfig.test.ts src/renderer/__tests__/EditorScreen.test.tsx`
Expected: FAIL — `Cannot find module '../editor/keymap.js'` / `'../components/EditorScreen.js'`

- [ ] **Step 3: keymap / inputConfig / Toast を実装**

`app/src/renderer/editor/keymap.ts`:

```ts
/** キーボードショートカットの純ロジック(スペック §7)。イベント→コマンド、シーク先、
 *  nudge のアクション解決、undo対象ソース。DOM 非依存でテスト可能。 */
import type { GridBeat } from "../../shared/deriveGrid.js";
import type { Marker } from "../../shared/types.js";
import { sectionIndexFromMarkerId } from "./markerTableModel.js";
import type { Action } from "../state/store.js";

export type LaneKey = "beatGrid" | "sections" | "hits" | "silence";

export type KeyCommand =
  | { kind: "playPause" }
  | { kind: "addMarker" }
  | { kind: "seek"; unit: "beat" | "bar"; dir: 1 | -1 }
  | { kind: "nudge"; dir: 1 | -1; coarse: boolean }
  | { kind: "toggleLane"; lane: LaneKey }
  | { kind: "undo" }
  | { kind: "redo" };

export interface KeyLike {
  key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; target: EventTarget | null;
}

const LANE_BY_DIGIT: Record<string, LaneKey> = { "1": "beatGrid", "2": "sections", "3": "hits", "4": "silence" };

function isTextInput(t: EventTarget | null): boolean {
  if (!t || typeof t !== "object" || !("tagName" in t)) return false;
  const el = t as { tagName?: string; isContentEditable?: boolean };
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true;
}

export function keyToCommand(e: KeyLike): KeyCommand | null {
  if (isTextInput(e.target)) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === "z" || e.key === "Z")) return e.shiftKey ? { kind: "redo" } : { kind: "undo" };
  if (mod) return null;
  switch (e.key) {
    case " ": return { kind: "playPause" };
    case "m": case "M": return { kind: "addMarker" };
    case "ArrowLeft": return { kind: "seek", unit: e.shiftKey ? "bar" : "beat", dir: -1 };
    case "ArrowRight": return { kind: "seek", unit: e.shiftKey ? "bar" : "beat", dir: 1 };
    case ",": return { kind: "nudge", dir: -1, coarse: e.shiftKey };
    case ".": return { kind: "nudge", dir: 1, coarse: e.shiftKey };
    default:
      return LANE_BY_DIGIT[e.key] ? { kind: "toggleLane", lane: LANE_BY_DIGIT[e.key]! } : null;
  }
}

/** dir 方向の最近傍格子点へシーク。無ければ null。 */
export function seekTarget(points: GridBeat[], curSec: number, dir: 1 | -1): number | null {
  if (dir === 1) {
    for (const p of points) if (p.timeSec > curSec + 1e-6) return p.timeSec;
    return null;
  }
  for (let i = points.length - 1; i >= 0; i--) if (points[i]!.timeSec < curSec - 1e-6) return points[i]!.timeSec;
  return null;
}

/** , / . の nudge を対象に応じたアクションへ。選択が custom→移動、section→境界移動、
 *  なし→グリッドオフセット(スペック §7「グリッドオフセットにも同じ操作系」)。 */
export function nudgeAction(
  cmd: { dir: 1 | -1; coarse: boolean }, selected: Marker | null,
  gridOffsetDeltaSec: number, originalSectionCount: number,
): Action {
  const delta = (cmd.coarse ? 0.01 : 0.001) * cmd.dir;
  if (selected?.type === "custom") {
    return { type: "CUSTOM_MARKER_UPDATED", id: selected.id, patch: { timeSec: selected.timeSec + delta } };
  }
  if (selected?.type === "section") {
    const idx = sectionIndexFromMarkerId(selected.id, originalSectionCount);
    if (idx !== null) return { type: "SECTION_EDIT_ADDED", op: { op: "move", index: idx, startSec: selected.timeSec + delta } };
  }
  return { type: "EDIT_APPLIED", edit: { gridOffsetDeltaSec: gridOffsetDeltaSec + delta } };
}

export function undoTargetSourceId(
  undo: { sourceId: string }[], redo: { sourceId: string }[], kind: "undo" | "redo",
): string | null {
  const stack = kind === "undo" ? undo : redo;
  return stack.length ? stack[stack.length - 1]!.sourceId : null;
}
```

`app/src/renderer/editor/inputConfig.ts`:

```ts
/** stereo-split は選択トラックのいずれかが実ステレオ(≥2ch)の時のみ提示する(台帳・スペック §3.1)。 */
export function canStereoSplit(selected: number[], channels: number[]): boolean {
  return selected.some((i) => (channels[i] ?? 0) >= 2);
}
```

`app/src/renderer/components/Toast.tsx`:

```tsx
/** 2秒で消えるトースト(ソース横断undo等の通知)。 */
import React, { useEffect } from "react";

export function Toast(props: { message: string | null; onDone: () => void }): React.JSX.Element | null {
  const { message, onDone } = props;
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onDone, 2000);
    return () => window.clearTimeout(id);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div role="status" style={{
      position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
      background: "#1f242d", border: "1px solid #3a4250", color: "#e8ebf0",
      padding: "8px 16px", borderRadius: 8, zIndex: 100, fontSize: 12,
    }}>{message}</div>
  );
}
```

- [ ] **Step 4: EditorScreen を実装**

`app/src/renderer/components/EditorScreen.tsx`:

```tsx
/** エディタ画面の組み立て(モック全体レイアウト、スペック §7)。ソースタブ・ショートカット・
 *  トースト・ピーク Worker 起動・書き出しフロー配線。子コンポーネントの props は A の T4-T6
 *  実装契約に合わせてある(下部の実装注を参照)。 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getIpc } from "../ipc.js";
import { selectBars, selectGrid, selectMarkers } from "../state/selectors.js";
import type { Action, AppState } from "../state/store.js";
import { runExportFlow, type ExportOpts } from "../state/exportFlow.js";
import type { PlaybackEngine } from "../audio/playback.js";
import { keyToCommand, nudgeAction, seekTarget, type KeyCommand } from "../editor/keymap.js";
import { sectionIndexFromMarkerId } from "../editor/markerTableModel.js";
import { snapSec } from "../editor/snap.js";
import type { PeakSet } from "../editor/peaks.js";
import type { Viewport } from "../editor/waveGeom.js";
import { ViewStoreProvider, useViewStore } from "../state/viewStore.js";
import { GridBar } from "./GridBar.js";
import { HitLanes } from "./HitLanes.js";
import { MarkerTable } from "./MarkerTable.js";
import { ExportPanel } from "./ExportPanel.js";
import { Transport } from "./Transport.js";
import { Overview } from "./Overview.js";
import { SectionBand } from "./SectionBand.js";
import { WaveCanvas } from "./WaveCanvas.js";
import { Toast } from "./Toast.js";

const SAMPLE_RATE = 44100; // playback wav

interface EditorScreenProps {
  state: Extract<AppState, { phase: "editor" }>;
  dispatch: (a: Action) => void;
  playback: PlaybackEngine | null;
}

export function EditorScreen(props: EditorScreenProps): React.JSX.Element {
  return (
    <ViewStoreProvider>
      <EditorBody {...props} />
    </ViewStoreProvider>
  );
}

function activeSourceOrFirst(project: EditorScreenProps["state"]["project"]) {
  const s = project.sources.find((x) => x.source.id === project.activeSourceId);
  if (s) return s;
  console.warn(`active source not found: ${project.activeSourceId}; 先頭ソースにフォールバック`);
  return project.sources[0]!;
}

function EditorBody({ state, dispatch, playback }: EditorScreenProps): React.JSX.Element {
  const { project } = state;
  const active = activeSourceOrFirst(project);
  const { view, dispatch: viewDispatch } = useViewStore();   // A の単一フック(= { view, dispatch })
  const [toast, setToast] = useState<string | null>(null);
  const [widthPx, setWidthPx] = useState(800);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [peaks, setPeaks] = useState<PeakSet | null>(null);
  const waveRef = useRef<HTMLDivElement>(null);

  const markers = selectMarkers(state);
  const grid = selectGrid(state);
  const bars = selectBars(state);

  const viewport: Viewport = {
    scrollSec: view.scrollSec, samplesPerPx: view.zoomSamplesPerPx, sampleRate: SAMPLE_RATE, widthPx,
  };
  const barIntervalSec = bars.length >= 2 ? bars[1]!.timeSec - bars[0]!.timeSec : 2;
  const anchorSec = active.edits.gridAnchor?.timeSec ?? null;

  // セクションマーカー → A の SectionView(SectionBand)/OverviewSection(Overview)ビュー
  const sectionViews = useMemo(
    () => markers
      .filter((m) => m.type === "section")
      .map((m) => ({ id: m.id, startSec: m.timeSec, durationSec: m.meta?.durationSec ?? 0, label: m.label, color: m.color })),
    [markers],
  );

  // 幅計測(Canvas座標系のため)
  useEffect(() => {
    const el = waveRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidthPx(el.clientWidth || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // プレイヘッド追従
  useEffect(() => {
    if (!playback) return;
    let raf = 0;
    const tick = (): void => { setPlayheadSec(playback.currentTime()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playback]);

  // 波形ピーク mipmap(A の T2 契約: Worker 起動は EditorScreen=T12 が行う)。
  // 再生用WAVをデコードして ch0 を Worker へ渡し PeakSet を受け取る。ブリッジ/AudioContext
  // 不在(vitest)ではスキップ → peaks=null のまま(WaveCanvas/Overview は null を許容)。
  useEffect(() => {
    let bridge: ReturnType<typeof getIpc> | null = null;
    try { bridge = getIpc(); } catch { /* ブリッジ不在 */ }
    if (!bridge || typeof AudioContext === "undefined") return;
    let cancelled = false;
    const ac = new AudioContext();
    void bridge.readFileBytes(project.playbackWavPath)
      .then((bytes) => ac.decodeAudioData(bytes.slice(0)))
      .then((buf) => {
        if (cancelled) return;
        const channel = buf.getChannelData(0).slice();   // ch0 をコピー(transfer 用)
        const w = new Worker(new URL("../editor/peaks.worker.ts", import.meta.url), { type: "module" });
        w.onmessage = (e: MessageEvent<{ peaks: PeakSet }>) => { if (!cancelled) setPeaks(e.data.peaks); w.terminate(); };
        w.postMessage({ type: "build", channel, sampleRate: buf.sampleRate }, [channel.buffer]);
      })
      .catch(() => { /* ピーク無しでもグリッド/マーカーは描画する */ });
    return () => { cancelled = true; void ac.close(); };
  }, [project.playbackWavPath]);

  const addMarkerAt = useCallback((sec: number): void => {
    const n = active.edits.customMarkers.length + 1;
    dispatch({
      type: "CUSTOM_MARKER_ADDED",
      marker: { id: `custom-${Date.now()}`, sourceId: active.source.id, timeSec: sec, type: "custom", label: `手動${n}`, color: "#ffd166", source: "user" },
    });
  }, [active, dispatch]);

  const doUndoRedo = useCallback((kind: "undo" | "redo"): void => {
    const stack = kind === "undo" ? state.undo : state.redo;
    const entry = stack[stack.length - 1];
    if (!entry) return;
    if (entry.sourceId !== project.activeSourceId) {
      dispatch({ type: "SOURCE_SWITCHED", sourceId: entry.sourceId });
      setToast("別ソースの操作を取り消しました");
    }
    dispatch({ type: kind === "undo" ? "UNDO" : "REDO" });
  }, [state.undo, state.redo, project.activeSourceId, dispatch]);

  const runCommand = useCallback((cmd: KeyCommand): void => {
    switch (cmd.kind) {
      case "playPause": if (playback) { playback.isPlaying() ? playback.pause() : playback.play(); } break;
      case "addMarker": if (playback) addMarkerAt(playback.currentTime()); break;
      case "seek": {
        if (!playback) break;
        const points = cmd.unit === "bar" ? bars : grid;
        const t = seekTarget(points, playback.currentTime(), cmd.dir);
        if (t !== null) playback.seek(t);
        break;
      }
      case "nudge": {
        const selected = markers.find((m) => m.id === state.selectedMarkerId) ?? null;
        dispatch(nudgeAction(cmd, selected, active.edits.gridOffsetDeltaSec, active.analysis.sections.length));
        break;
      }
      case "toggleLane": viewDispatch({ type: "TOGGLE_LANE", lane: cmd.lane }); break;
      case "undo": doUndoRedo("undo"); break;
      case "redo": doUndoRedo("redo"); break;
    }
  }, [playback, bars, grid, markers, state.selectedMarkerId, active, dispatch, viewDispatch, addMarkerAt, doUndoRedo]);

  // window キーボード
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const cmd = keyToCommand({ key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, target: e.target });
      if (!cmd) return;
      e.preventDefault();
      runCommand(cmd);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runCommand]);

  // メニュー由来 undo/redo(T11 の useProjectFile は file 操作のみ処理)。
  // ブリッジ不在(vitest)では購読しない — getIpc() の throw で描画が壊れないようガードする。
  useEffect(() => {
    let bridge: ReturnType<typeof getIpc> | null = null;
    try { bridge = getIpc(); } catch { /* ブリッジ不在 */ }
    if (!bridge) return;
    return bridge.onMenu((ev) => {
      if (ev.action === "undo") doUndoRedo("undo");
      else if (ev.action === "redo") doUndoRedo("redo");
    });
  }, [doUndoRedo]);

  const onSeek = useCallback((sec: number) => playback?.seek(sec), [playback]);
  const onExport = useCallback((opts: ExportOpts) => runExportFlow(opts, project, getIpc()), [project]);
  // オーバービューのクリック/ドラッグ: シーク+表示窓をその位置へ寄せる(A の onScrubTo 契約)
  const onScrubTo = useCallback((sec: number) => {
    playback?.seek(sec);
    const halfSpanSec = (widthPx * view.zoomSamplesPerPx) / SAMPLE_RATE / 2;
    viewDispatch({ type: "SET_VIEW", scrollSec: Math.max(0, sec - halfSpanSec) });
  }, [playback, widthPx, view.zoomSamplesPerPx, viewDispatch]);
  // セクション境界ドラッグのスナップ(A の SectionBand が要求する snap(sec)=>sec)
  const snapForBoundary = useCallback(
    (sec: number) => snapSec(sec, view.snapMode, { fps: project.fps, grid }),
    [view.snapMode, project.fps, grid],
  );

  // playback は App.tsx がエディタ入場時に生成する。生成前の一瞬(null)は簡易表示にフォールバックし、
  // 以降 Transport/WaveCanvas(A の契約は playback 非 null)に非 null を渡す。全 hooks はこの分岐より上で
  // 呼ぶため hook 順序は不変。
  if (!playback) {
    return <div style={styles.root}><div style={{ margin: "auto", opacity: 0.7 }}>再生バッファを読み込み中…</div></div>;
  }

  return (
    <div style={styles.root}>
      {/* ヘッダ + ソースタブ */}
      <header style={styles.header}>
        <div style={styles.logo}>Beat<span style={{ color: "#ff4d6b" }}>Marks</span></div>
        <div style={styles.filechip}><b>{project.baseName}</b></div>
        <div style={styles.tabs}>
          {project.sources.map((s) => (
            <button key={s.source.id}
              style={s.source.id === project.activeSourceId ? styles.tabOn : styles.tab}
              onClick={() => dispatch({ type: "SOURCE_SWITCHED", sourceId: s.source.id })}>{s.source.label}</button>
          ))}
        </div>
      </header>

      {/* Transport(A T4 契約: grid は GridBeat[]・playback は非 null。メトロノーム用 GridClick 変換は App.tsx が担当) */}
      <Transport playback={playback} grid={grid} fps={project.fps}
        onAddMarker={addMarkerAt} onTapTempo={(bpm) => dispatch({ type: "EDIT_APPLIED", edit: { bpmOverride: bpm } })} />

      <GridBar analysis={active.analysis} edits={active.edits} playheadSec={playheadSec}
        canUndo={state.undo.length > 0} canRedo={state.redo.length > 0} dispatch={dispatch} />

      {/* Overview(A T6 契約: peaks / sections=OverviewSection[] / durationSec / viewport / playheadSec / onScrubTo) */}
      <Overview peaks={peaks} sections={sectionViews} durationSec={project.durationSec}
        viewport={viewport} playheadSec={playheadSec} onScrubTo={onScrubTo} />

      <div style={styles.wavezone}>
        {/* SectionBand(A T6 契約)。onMoveBoundary は元セクション添字を直接受け取り、
            onRename は配列添字で来るので sectionViews[i].id → 元添字へ翻訳する。 */}
        <SectionBand
          sections={sectionViews} viewport={viewport} barIntervalSec={barIntervalSec} playheadSec={playheadSec}
          snap={snapForBoundary}
          onMoveBoundary={(index, sec) => dispatch({ type: "SECTION_EDIT_ADDED", op: { op: "move", index, startSec: sec } })}
          onRename={(arrayIdx, label) => {
            const id = sectionViews[arrayIdx]?.id;
            const idx = id ? sectionIndexFromMarkerId(id, active.analysis.sections.length) : null;
            if (idx !== null) dispatch({ type: "SECTION_EDIT_ADDED", op: { op: "rename", index: idx, label } });
          }}
          onDelete={(id) => dispatch({ type: "MARKER_DELETED", id })}
          onAddAtPlayhead={() => dispatch({ type: "SECTION_EDIT_ADDED", op: { op: "add", startSec: playheadSec, label: "新規セクション", color: "#5b7fd4" } })}
        />
        <div ref={waveRef} style={styles.maincanvas}>
          {/* WaveCanvas(A T5 契約: peaks/grid/markers/anchorSec/playback/sampleRate/onSelectMarker/onAnchorDrag。
              scroll/zoom は WaveCanvas が viewStore を内部購読するため viewport prop は渡さない) */}
          <WaveCanvas
            peaks={peaks} grid={grid} markers={markers} anchorSec={anchorSec}
            playback={playback} sampleRate={SAMPLE_RATE}
            onSelectMarker={(id) => dispatch({ type: "MARKER_SELECTED", markerId: id })}
            onAnchorDrag={(sec) => dispatch({ type: "EDIT_APPLIED", edit: { gridAnchor: { timeSec: sec, freeBefore: active.edits.gridAnchor?.freeBefore ?? true } } })}
          />
        </div>
        {view.laneVisibility.hits && (
          <HitLanes hits={active.analysis.hits} threshold={active.edits.hitThreshold}
            viewport={viewport} selectedMarkerId={state.selectedMarkerId} dispatch={dispatch} />
        )}
      </div>

      <div style={styles.bottom}>
        <MarkerTable activeSource={active} sources={project.sources} fps={project.fps} rounding={project.rounding}
          selectedMarkerId={state.selectedMarkerId} dispatch={dispatch} onSeek={onSeek}
          onAddMarker={() => addMarkerAt(playback.currentTime())} />
        <ExportPanel fps={project.fps} rounding={project.rounding}
          sources={project.sources.map((s) => ({ id: s.source.id, label: s.source.label }))}
          activeSourceId={project.activeSourceId} dispatch={dispatch} onExport={onExport} />
      </div>

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#0d0f13", color: "#e8ebf0" },
  header: { display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", background: "#14171c", borderBottom: "1px solid #262c36", flex: "none" },
  logo: { fontWeight: 800, fontSize: 14 },
  filechip: { background: "#191d24", border: "1px solid #262c36", borderRadius: 6, padding: "5px 10px", color: "#8b94a3" },
  tabs: { display: "flex", gap: 6, marginLeft: "auto" },
  tab: { background: "#1f242d", color: "#8b94a3", border: "1px solid #262c36", borderRadius: 6, padding: "4px 10px", cursor: "pointer" },
  tabOn: { background: "#2a3140", color: "#ffd166", border: "1px solid #ffd166", borderRadius: 6, padding: "4px 10px", cursor: "pointer" },
  wavezone: { position: "relative", flex: "1 1 auto", minHeight: 230, display: "flex", flexDirection: "column", background: "#0d0f13", overflow: "hidden" },
  maincanvas: { flex: "1 1 auto", margin: "0 14px", position: "relative" },
  bottom: { flex: "none", height: 238, display: "flex", borderTop: "1px solid #262c36", background: "#14171c" },
};
```

> 実装注(**A の T4-T6 実装と突き合わせ済み**): 上の受け渡しは A が実際に書いた props 契約に合わせてある —
> `Transport`={playback, grid: GridBeat[], fps, onAddMarker, onTapTempo}、
> `Overview`={peaks, sections: OverviewSection[], durationSec, viewport, playheadSec, onScrubTo}、
> `SectionBand`={sections: SectionView[], viewport, barIntervalSec, playheadSec, snap, onMoveBoundary(元セクション添字,sec), onRename(配列添字,label), onDelete(id), onAddAtPlayhead}、
> `WaveCanvas`={peaks, grid, markers, anchorSec, playback, sampleRate, onSelectMarker, onAnchorDrag}(scroll/zoom は WaveCanvas が viewStore を内部購読)。
> `Transport`/`WaveCanvas` は viewStore を内部で使うため `ViewStoreProvider` の内側(=EditorBody 内)で描画される必要がある(本構成で満たす)。

- [ ] **Step 5: App.tsx を仕上げ版へ**

`app/src/renderer/App.tsx` を以下で置換(dev確認UIを EditorScreen に差し替え、AnalyzeOutcome 分岐・error 画面・抽出インジケータ・stereo-split ゲーティング・防御化・useProjectFile 配線):

```tsx
import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { InputConfig } from "../shared/ipc.js";
import { createPlayback, type PlaybackEngine } from "./audio/playback.js";
import { EditorScreen } from "./components/EditorScreen.js";
import { canStereoSplit } from "./editor/inputConfig.js";
import { useProjectFile } from "./hooks/useProjectFile.js";
import { getIpc } from "./ipc.js";
import { selectGrid } from "./state/selectors.js";
import { initialState, reducer } from "./state/store.js";

const box: React.CSSProperties = { background: "#14171c", border: "1px solid #262c36", borderRadius: 8, padding: 16 };

export function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const playbackRef = useRef<PlaybackEngine | null>(null);
  const [playback, setPlayback] = useState<PlaybackEngine | null>(null);

  useProjectFile(state, dispatch);

  // 進捗購読
  useEffect(() => getIpc().onAnalyzeProgress((ev) => dispatch({ type: "ANALYZE_PROGRESS", progress: ev })), []);

  // エディタ入場で再生バッファをロード
  useEffect(() => {
    if (state.phase !== "editor") return;
    const pb = createPlayback();
    playbackRef.current = pb;
    setPlayback(pb);
    void getIpc().readFileBytes(state.project.playbackWavPath).then((bytes) => pb.load(bytes));
    return () => { pb.dispose(); playbackRef.current = null; setPlayback(null); };
  }, [state.phase === "editor" ? state.project.playbackWavPath : null]);

  // グリッド → メトロノーム
  const grid = useMemo(() => selectGrid(state).map((b) => ({ timeSec: b.timeSec, isBar: b.isBar })), [state]);
  useEffect(() => { playbackRef.current?.updateGrid(grid); }, [grid]);

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    try {
      const path = getIpc().getPathForFile(file);
      const probe = await getIpc().probeMedia(path);
      if (probe.tracks.length <= 1) {
        await startAnalyze(path, { mode: "mix", trackIndexes: [0], channelSplit: "mono" });
      } else {
        dispatch({ type: "FILE_PROBED", filePath: path, probe });
      }
    } catch (err) {
      alert(`ファイルの読み込みに失敗しました: ${String(err)}`);
    }
  }

  async function startAnalyze(filePath: string, input: InputConfig): Promise<void> {
    dispatch({ type: "ANALYZE_STARTED" });
    try {
      const outcome = await getIpc().analyzeMedia({ filePath, input });
      if (outcome.cancelled) dispatch({ type: "RESET" });          // キャンセルはセンチネルで判別(メッセージ照合禁止)
      else dispatch({ type: "PROJECT_READY", project: outcome.project });
    } catch (err) {
      dispatch({ type: "ANALYZE_FAILED", message: String(err) });
    }
  }

  if (state.phase === "drop") {
    return (
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => void onDrop(e)}
        style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        <div style={{ ...box, textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>BeatMarks</div>
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>音声・動画ファイルをここにドロップ</div>
        </div>
      </div>
    );
  }

  if (state.phase === "input-config") {
    return (
      <InputConfigScreen
        tracks={state.probe.tracks.map((t, i) => ({ title: t.title ?? `Track ${i + 1}（${t.channels}ch）`, channels: t.channels }))}
        onStart={(input) => void startAnalyze(state.filePath, input)}
      />
    );
  }

  if (state.phase === "analyzing") {
    const p = state.progress;
    const extracting = !p || p.stage === "extract";
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        <div style={{ ...box, width: 420 }}>
          <div style={{ fontWeight: 700 }}>{extracting ? "抽出中…" : "解析中…"}</div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            {p && !extracting ? `${p.sourceLabel}（${p.sourceIndex + 1}/${p.sourceCount}）: ${p.stage}` : "音声を抽出しています"}
          </div>
          <div style={{ marginTop: 8, height: 6, background: "#262c36", borderRadius: 3 }}>
            <div style={{ height: 6, borderRadius: 3, background: "#ff4d6b", width: `${p?.percent ?? 0}%`, transition: "width .2s" }} />
          </div>
          <button style={{ marginTop: 12 }} onClick={() => void getIpc().cancelAnalyze()}>キャンセル</button>
          <div style={{ marginTop: 6, fontSize: 10, color: "#5a6272" }}>※ キャンセルは解析開始後に有効になります</div>
        </div>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        <div style={{ ...box, width: 460 }}>
          <div style={{ fontWeight: 700, color: "#ff4d6b" }}>解析に失敗しました</div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85, whiteSpace: "pre-wrap" }}>{state.errorMessage}</div>
          <button style={{ marginTop: 12 }} onClick={() => dispatch({ type: "RESET" })}>最初に戻る</button>
        </div>
      </div>
    );
  }

  return <EditorScreen state={state} dispatch={dispatch} playback={playback} />;
}

function InputConfigScreen(props: {
  tracks: { title: string; channels: number }[];
  onStart: (input: InputConfig) => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<number[]>([0]);
  const [mode, setMode] = useState<"mix" | "multitrack">("mix");
  const [split, setSplit] = useState<"mono" | "stereo-split">("mono");
  const channels = props.tracks.map((t) => t.channels);
  const stereoOk = canStereoSplit(selected, channels);
  // 選択がモノだけになったら stereo-split を強制解除
  useEffect(() => { if (!stereoOk && split === "stereo-split") setSplit("mono"); }, [stereoOk, split]);

  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
      <div style={{ ...box, width: 480, display: "grid", gap: 10 }}>
        <b>入力設定（複数トラック検出）</b>
        {props.tracks.map((t, i) => (
          <label key={i} style={{ fontSize: 13 }}>
            <input type="checkbox" checked={selected.includes(i)}
              onChange={(e) => setSelected(e.target.checked ? [...selected, i].sort() : selected.filter((x) => x !== i))} /> {t.title}
          </label>
        ))}
        <label style={{ fontSize: 13 }}>
          <input type="radio" checked={mode === "mix"} onChange={() => setMode("mix")} /> 選択トラックを2mixに統合
        </label>
        <label style={{ fontSize: 13 }}>
          <input type="radio" checked={mode === "multitrack"} onChange={() => setMode("multitrack")} /> マルチトラックとして読み込む
        </label>
        {mode === "mix" && stereoOk && (
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={split === "stereo-split"}
              onChange={(e) => setSplit(e.target.checked ? "stereo-split" : "mono")} /> L/R を個別ソースとして解析
          </label>
        )}
        {mode === "mix" && !stereoOk && (
          <div style={{ fontSize: 11, color: "#5a6272" }}>※ 選択トラックはモノラルのため L/R 分割はできません</div>
        )}
        <button disabled={selected.length === 0}
          onClick={() => props.onStart({ mode, trackIndexes: selected, channelSplit: split })}>解析開始</button>
      </div>
    </div>
  );
}
```

> error フェーズの表示は **A の実フィールド `state.errorMessage`** を読む(上のコードで反映済み)。`ANALYZE_FAILED` は `{ type:"ANALYZE_FAILED"; message: string }`(action 側は `message`)。`analyzeMedia` の戻り `AnalyzeOutcome` は A の T1 型(`{cancelled:false;project}|{cancelled:true}`)。

- [ ] **Step 6: 手動QAチェックリストを作成**

`docs/manual-qa-editor.md`(③cの本 manual-qa.md の種。各モック操作×期待挙動、~40行):

```markdown
# BeatMarks エディタ 手動QAチェックリスト(③b成果物)

> Electron はこの環境で実行不可のため、③c(CI/E2E)で実施する項目。各行 [ ] を実機で確認。

## トランスポート(T4)
- [ ] Space で再生/停止が切り替わる
- [ ] ループ ON で loop A-B を巡回、シーク時に発火済みクリック音が止まる
- [ ] メトロノーム ON でビートにクリックが乗る(小節頭は高音)
- [ ] タップテンポで BPM が上書きされグリッドが再生成される
- [ ] タイムコードが指定 fps で表示される

## グリッド補正バー(T8)
- [ ] BPM をクリック→直接入力→Enter で確定、30..300 外は shake で拒否
- [ ] −10/−1/+1/+10ms でオフセットが増減、表示が +NNms
- [ ] 拍子 4/4・3/4・6/8 切替でグリッドが変わる
- [ ] 1拍目 ←/→ で小節頭がずれる、アンカー設定/解除が効く
- [ ] キー表示(名前・Camelot・信頼度)が出る、Undo/Redo ボタンが状態連動

## 波形/オーバービュー/セクション帯(T5/T6)
- [ ] ホイールでカーソル中心ズーム、オーバービューのドラッグで表示範囲移動
- [ ] 拍/小節グリッド+小節番号、静寂ハッチ、アンカー旗、フリー区間の減光
- [ ] セクション境界ドラッグ移動/ダブルクリックでリネーム
- [ ] プレイヘッドが再生に追従

## ヒットレーン(T7)
- [ ] 低/中/高の3レーンにティック、感度スライダーで即座に増減(再解析なし)
- [ ] ティッククリックで選択がテーブルと同期

## マーカーテーブル(T9)
- [ ] 種別フィルタチップ、行クリックでジャンプ+選択
- [ ] 手動/セクションのリネーム、削除→削除済みトグルから復元
- [ ] ソース横断表示で全ソースのマーカーが時刻順に並ぶ

## 書き出し(T10)
- [ ] fps/丸め/含めるマーカー/ソース選択、ターゲット複数選択
- [ ] 保存先ダイアログ→指定フォルダに全ファイル生成、成功/失敗トースト
- [ ] wav入力は元音声に cue 埋め込み、動画入力は抽出WAVに埋め込み
- [ ] 6/8 の MIDI で拍子分母が 8(無音破損しない)

## .bmk/メニュー(T11)
- [ ] 保存/別名で保存、再オープンで mediaPath から波形再抽出
- [ ] mediaHash 不一致で「続行/中止」ダイアログ
- [ ] 最近使ったファイル(最大5)、タイトルに未保存 • 表示
- [ ] メニュー 開く/保存/取り消し/やり直しが効く

## ショートカット/統合(T12)
- [ ] M で手動マーカー、←→で拍シーク、Shift+←→で小節シーク
- [ ] `,`/`.` で選択マーカー(なければオフセット)を ±1/10ms nudge
- [ ] 1〜4 でレーン表示切替、⌘Z/⇧⌘Z で取消/やり直し
- [ ] 非アクティブソースの取消でタブ自動切替+トースト
- [ ] ソースタブ切替で表示が変わる、入力設定でモノ選択時に stereo-split 非表示
```

- [ ] **Step 7: 全スイート+ビルド+タイプチェック**

Run: `cd /home/claude/beatmarks/app && npx vitest run && npx tsc --noEmit && npx tsc -p tsconfig.node.json --noEmit && npx electron-vite build 2>&1 | tail -3`
Expected: 全 vitest 緑(本タスク追加分 ~7件を含む、③b全体で既存+新規すべて緑)、typecheck OK、ビルド成功

- [ ] **Step 8: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/renderer/editor/keymap.ts app/src/renderer/editor/inputConfig.ts \
  app/src/renderer/components/Toast.tsx app/src/renderer/components/EditorScreen.tsx \
  app/src/renderer/App.tsx app/src/renderer/__tests__/keymap.test.ts \
  app/src/renderer/__tests__/inputConfig.test.ts app/src/renderer/__tests__/EditorScreen.test.tsx \
  docs/manual-qa-editor.md
git commit -m "feat(app): エディタ画面統合・キーボードショートカット・仕上げ(トースト/抽出表示/防御化)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SR5fj8BNeN6TUFgoj4zhm6"
```

---

## 完了条件(計画③b)

全 Task(1-12)完了時、`cd /home/claude/beatmarks/app` で以下がすべて満たされること。

- [ ] **vitest 全緑**: `npx vitest run` が全ファイル pass(既存の jsdom/node 混在は per-file `// @vitest-environment jsdom` で解決済み)。
  - 期待テスト数(概算 **~355**): A 実装検証済みの **293**(③a由来 214 + T1:11 + T2:8 + T3:22 + T4:11 + T5:15 + T6:12)に、B 見積の T7-12 追加分 **約60**(T7:5 / T8:10 / T9:11 / T10:~10 / T11:~17 / T12:~9)を加えた値。**T7-12 は実装未検証の見積のため ±数件の増減はレビューで許容**(TDD の Red→Green を各タスクで通せば整合する)。
- [ ] **両 tsc グリーン**: `npx tsc --noEmit`(renderer/shared, `types:[]`)と `npx tsc -p tsconfig.node.json --noEmit`(main/preload, `types:["node"]`)が両方エラー無し。
- [ ] **electron-vite build 成功**: `npx electron-vite build`(この環境で electron バイナリ取得不可のときはスキップ可 — GUI 動作確認は③cのCI/E2Eで担保)。
- [ ] **ゴールデン不変**: 計画②のエクスポータ・ゴールデン(`src/shared/__tests__/golden/*`、integration-golden)は本計画で**再生成しない**。T10 は既存エクスポータを呼ぶだけで出力仕様を変えないため、ゴールデン差分ゼロ。本計画で新規ゴールデンは追加しない(MIDI 長ラベルは構造走査テストで検証)。
- [ ] **1タスク1コミット**: 各 Task の末尾コミットが日本語 conventional(feat/fix/test/docs)で積まれている。

## この計画がやらないこと(計画③cの責務)

以下は本計画(③b)のスコープ外。**計画③c**で扱う。

- **パッケージング**: electron-builder 設定、エンジン(Python/実行体)と ffmpeg/ffprobe のバンドル、`THIRD_PARTY_LICENSES.md` の生成(GPL/AGPL 非混入の最終確認を含む)。
- **CI(GitHub Actions)**: macOS / Windows のビルドマトリクス、成果物アップロード、リリース。
- **E2E**: Playwright + xvfb による Electron 実起動テスト(ドロップ→解析→編集→書き出し→再オープンの通し)。本計画で実行不可の GUI/Worker 起動・Canvas 描画・IPC 実配線はここで担保する。
- **手動QA本版**: `docs/manual-qa.md` のフルバージョン。本計画では種として `docs/manual-qa-editor.md`(T12)のチェックリストのみを作る。
