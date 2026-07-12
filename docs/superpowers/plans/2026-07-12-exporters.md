# BeatMarks エクスポータ+マーカー導出(Phase 1 / 計画②) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エンジンの解析JSON+ユーザー編集(EditState)から最終マーカー列を導出し、11形式(JSON / CSV / MIDI / AE .jsx / Premiere FCP XML / Resolve EDL / Blender .py / WAVキュー埋め込み / REAPER CSV / Nuendo CSV / Audacity txt)へ書き出す TypeScript 共有ライブラリを、Electron なしで単体テスト可能な形で完成させる。

**Architecture:** `app/src/shared/` に純粋関数のみで構成(I/O・DOM・Electron API 禁止)。「解析+編集 → 導出マーカー列」(derive) と「マーカー列+設定 → 文字列/bytes」(exporters) の2層。時刻は常に秒 float で持ち、フレーム変換は timebase モジュール経由でエクスポートの瞬間だけ行う(スペック §6)。全エクスポータはゴールデン(スナップショット)テストで固定する。

**Tech Stack:** TypeScript 5 (strict) / Node 22 / npm / vitest。**ランタイム依存ゼロ**(バイナリ生成も Uint8Array/DataView のみ。後で Electron レンダラーでもそのまま動く)

**参照スペック:** `docs/superpowers/specs/2026-07-12-beatmarks-design.md` §3.3, §3.4, §6, §8
**前提:** 計画①完了済み(エンジンの出力 JSON 形が確定している。fixture 生成にエンジンの venv を使う)

## Global Constraints

- ライセンス方針(2026-07-12 承認): GPL/AGPL 禁止。LGPL は動的リンク/別プロセスなら許容。**この計画の追加依存は dev 依存(typescript / vitest / @types/node)のみ**で、いずれも Apache-2.0 / MIT。ランタイム依存の追加は禁止
- 時刻は常に **秒 (float)** で保持。フレーム変換はエクスポート時のみ。fps は分数 `{num, den}` で扱い、浮動小数の 29.97 を計算に使わない(`frame = round(t * num / den)` / `floor`)。丸めは都度計算で累積誤差なし(スペック §6)
- タイムコード表示はノンドロップ既定(スペック §6)
- 出力ファイル命名: `<元ファイル名>_<略称>.<拡張子>`、マルチソース時 `<元>_<ソース名>_<略称>.<ext>`。略称テーブルはスペック §8 のとおり(AE / PPro / Resolve / Blender / markers / cues / REAPER / Nuendo / Audacity)
- AE 用 .jsx は **ExtendScript (ES3)** 互換コードを生成する: `const`/`let`/アロー関数/テンプレートリテラル/`JSON.*` 禁止。エフェクトは matchName(`ADBE Slider Control` 等)で参照しロケール非依存にする
- 静寂・ヒットのしきい値フィルタは UI/導出側の責務(エンジンは全候補を返す)— このライブラリが再フィルタを実装する(スペック §3.2-5, §5)
- テストは決定的。エクスポータはゴールデンテストで固定。29.97fps で 10 分相当でも丸め誤差が累積しないことを境界テストする(スペック §10)
- エンジン fixture(実際の解析 JSON)はエンジン CLI で生成してリポジトリにコミットする(生成コマンドをファイル先頭コメントに記録)
- 各タスク末尾で必ずコミット(`feat:` / `test:` / `fix:` プレフィックス、`(app)` スコープ)
- リポジトリルート: `/home/claude/beatmarks`。作業は `app/` 配下(`engine/` は fixture 生成の読み取りのみ、変更禁止)
- TypeScript は `strict: true`。`any` の使用は JSON 境界の入口 1 箇所(バリデータ)のみ許可

## File Structure

```
app/
  package.json               # npm パッケージ(dev依存のみ)
  tsconfig.json
  vitest.config.ts
  src/shared/
    types.ts                 # 全型定義(スペック §6 の TS 化)(Task 1)
    validate.ts              # エンジン JSON の形チェック(Task 1)
    timebase.ts              # fps・フレーム・タイムコード(Task 2)
    envelope.ts              # エンベロープ再サンプル+静寂再フィルタ(Task 3)
    deriveGrid.ts            # 編集適用後の拍/小節グリッド導出(Task 4)
    deriveMarkers.ts         # 最終マーカー列の組み立て(Task 5)
    naming.ts                # ターゲット表・略称・ファイル名(Task 6)
    exporters/
      helpers.ts             # 共通(選別・エスケープ・行組み立て)(Task 6)
      json.ts                # 正規 JSON(Task 7)
      csv.ts                 # 汎用 CSV(Task 7)
      midi.ts                # SMF format1(Task 8)
      aejsx.ts               # After Effects .jsx(Task 9)
      premiereXml.ts         # FCP XML (xmeml v4)(Task 10)
      resolveEdl.ts          # マーカー EDL(Task 11)
      blenderPy.ts           # Blender .py(Task 12)
      reaperCsv.ts           # REAPER 用タブ区切り(Task 12)
      nuendoCsv.ts           # Nuendo マーカー CSV(Task 12)
      audacityTxt.ts         # Audacity ラベル(Task 12)
      wavCues.ts             # WAV cue チャンク埋め込み(Task 13)
      index.ts               # ターゲット→エクスポータのレジストリ(Task 14)
    __fixtures__/
      analysis-30s.json      # エンジン実出力(生成コマンド付き)(Task 1)
    __tests__/
      *.test.ts              # 各タスクのテスト
      golden/                # ゴールデン出力(コミットする)(Task 14)
```

**依存の向き:** types ← validate / timebase / envelope ← deriveGrid ← deriveMarkers ← exporters/* ← exporters/index。逆流禁止。

---

### Task 1: app スキャフォールドと型定義・エンジン fixture

**Files:**
- Create: `app/package.json`
- Create: `app/tsconfig.json`
- Create: `app/vitest.config.ts`
- Create: `app/.gitignore`
- Create: `app/src/shared/types.ts`
- Create: `app/src/shared/validate.ts`
- Create: `app/src/shared/__fixtures__/analysis-30s.json`(エンジンで生成)
- Test: `app/src/shared/__tests__/validate.test.ts`

**Interfaces:**
- Consumes: エンジン CLI(fixture 生成のみ): `engine/.venv` + `python -m beatmarks_engine --analyze`
- Produces(以降の全タスクが使う):
  - `types.ts`: `Fps {num,den}` / `RoundingMode = 'nearest'|'floor'` / `MarkerType = 'beat'|'bar'|'section'|'hit'|'silence'|'custom'` / `Band = 'low'|'mid'|'high'` / `Marker {id, sourceId, timeSec, type, label, color, source:'auto'|'user', meta?{strength?, band?, durationSec?, barNumber?}}` / `KeyGuess {name,camelot,confidence}` / `TempoPoint {timeSec,bpm}` / `SectionInfo {startSec,endSec,label,clusterId,chorusCandidate}` / `HitInfo {timeSec,band,strength}` / `SilenceInfo {startSec,endSec,floorDb}` / `Envelopes {sampleRateHz, total, low, mid, high: number[]}` / `AnalysisResult`(エンジン analysis と同形)/ `EngineResult {analysis, warnings}` / `SectionEdit`(下記)/ `EditState` / `ExportContext {fps, rounding, include: MarkerType[], baseName, sourceLabel: string|null, audioFileName, audioDurationSec, bpmLabel, keyLabel, beatsPerBar, tempoMap: TempoPoint[], envelopes: Envelopes|null}` 
  - `SectionEdit` は判別共用体: `{op:'move', index, startSec}` | `{op:'rename', index, label}` | `{op:'recolor', index, color}` | `{op:'add', startSec, label, color}` | `{op:'delete', index}`(index は**元の analysis.sections の添字**。add で増えた分は `index = analysis長+追加順` で参照)
  - `EditState {gridOffsetDeltaSec, bpmOverride?, beatsPerBar, downbeatShift, gridAnchor?{timeSec, freeBefore}, sectionEdits: SectionEdit[], hitThreshold {low,mid,high}, silenceThreshold {db, minDurSec}, customMarkers: Marker[], deletedMarkerIds: string[]}`
  - `validate.ts`: `parseEngineResult(jsonText: string): EngineResult`(形が違えば `ValidationError` を投げる)/ `defaultEditState(): EditState`
  - fixture: `analysis-30s.json` = エンジン実出力(30 秒、クリック+構造変化)

- [ ] **Step 1: npm パッケージと設定ファイルを書く**

`app/package.json`:

```json
{
  "name": "beatmarks-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

`app/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`app/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
```

`app/.gitignore`:

```
node_modules/
```

インストール:

```bash
cd /home/claude/beatmarks/app && npm install
```

Expected: `added ... packages`(lockfile `package-lock.json` が生成される。**コミットに含める**)

- [ ] **Step 2: エンジン fixture を生成する**

```bash
cd /home/claude/beatmarks/engine && source .venv/bin/activate
python - << 'PY'
import sys
sys.path.insert(0, "tests")
import numpy as np
from synth import click_track, structure_track, write_wav
clicks, _ = click_track(120.0, 30.0, base_amp=0.5)
y = structure_track() * 0.6 + clicks * 0.5
y = (y / float(np.max(np.abs(y))) * 0.9).astype(np.float32)
write_wav("/tmp/bm_fixture30.wav", y)
PY
python -m beatmarks_engine --analyze /tmp/bm_fixture30.wav --out /tmp/bm_fixture30.json
python - << 'PY'
import json
d = json.load(open("/tmp/bm_fixture30.json"))
header = {"_generatedBy": "engine 0.1.0 / python -m beatmarks_engine --analyze <synth 30s: structure_track*0.6 + click_track(120,30,base_amp=0.5)*0.5, normalized 0.9>"}
header.update(d)
with open("/home/claude/beatmarks/app/src/shared/__fixtures__/analysis-30s.json", "w") as f:
    json.dump(header, f, ensure_ascii=False)
print("fixture written, keys:", list(header.keys()))
PY
```

Expected: `fixture written, keys: ['_generatedBy', 'analysis', 'warnings']`

- [ ] **Step 3: 失敗するテストを書く**

`app/src/shared/__tests__/validate.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseEngineResult, ValidationError, defaultEditState } from "../validate.js";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "analysis-30s.json",
);

describe("parseEngineResult", () => {
  it("エンジン実出力のfixtureをパースできる", () => {
    const r = parseEngineResult(readFileSync(FIXTURE, "utf-8"));
    expect(Math.abs(r.analysis.durationSec - 30)).toBeLessThan(0.1);
    expect(r.analysis.beats.length).toBeGreaterThan(30);
    expect(["fixed", "variable"]).toContain(r.analysis.tempoMode);
    expect([0, 1, 2, 3]).toContain(r.analysis.downbeatPhase);
    expect(r.analysis.sections[0]!.startSec).toBe(0);
    expect(r.analysis.key.perSection.length).toBe(r.analysis.sections.length);
    expect(r.analysis.envelopes.sampleRateHz).toBe(100);
    expect(r.analysis.hits.length).toBeGreaterThan(0);
    expect(Array.isArray(r.warnings)).toBe(true);
  });

  it("壊れたJSONはValidationError", () => {
    expect(() => parseEngineResult("not json")).toThrow(ValidationError);
  });

  it("形が違うJSONはValidationError", () => {
    expect(() => parseEngineResult('{"analysis": {"nope": 1}}')).toThrow(ValidationError);
    expect(() => parseEngineResult('{"warnings": []}')).toThrow(ValidationError);
  });

  it("defaultEditStateは編集なしを表す", () => {
    const e = defaultEditState();
    expect(e.gridOffsetDeltaSec).toBe(0);
    expect(e.beatsPerBar).toBe(4);
    expect(e.downbeatShift).toBe(0);
    expect(e.sectionEdits).toEqual([]);
    expect(e.hitThreshold).toEqual({ low: 0, mid: 0, high: 0 });
    expect(e.silenceThreshold).toEqual({ db: -45, minDurSec: 0.7 });
    expect(e.customMarkers).toEqual([]);
    expect(e.deletedMarkerIds).toEqual([]);
  });
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `cd /home/claude/beatmarks/app && npx vitest run src/shared/__tests__/validate.test.ts`
Expected: FAIL — `Cannot find module '../validate.js'` 相当のエラー

- [ ] **Step 5: 型定義とバリデータを実装**

`app/src/shared/types.ts`:

```ts
/** スペック §6 データモデルの TypeScript 定義。時刻は常に秒 (float)。 */

export interface Fps {
  num: number; // 例 29.97 = {num: 30000, den: 1001}
  den: number;
}

export type RoundingMode = "nearest" | "floor";

export type MarkerType = "beat" | "bar" | "section" | "hit" | "silence" | "custom";
export type Band = "low" | "mid" | "high";

export interface Marker {
  id: string;
  sourceId: string;
  timeSec: number;
  type: MarkerType;
  label: string;
  color: string; // "#rrggbb"
  source: "auto" | "user";
  meta?: {
    strength?: number;
    band?: Band;
    durationSec?: number; // section / silence はリージョン
    barNumber?: number;   // bar マーカー
  };
}

export interface KeyGuess {
  name: string;
  camelot: string;
  confidence: number;
}

export interface TempoPoint {
  timeSec: number;
  bpm: number;
}

export interface SectionInfo {
  startSec: number;
  endSec: number;
  label: string;
  clusterId: number;
  chorusCandidate: boolean;
}

export interface HitInfo {
  timeSec: number;
  band: Band;
  strength: number;
}

export interface SilenceInfo {
  startSec: number;
  endSec: number;
  floorDb: number;
}

export interface Envelopes {
  sampleRateHz: number; // エンジンは 100
  total: number[];
  low: number[];
  mid: number[];
  high: number[];
}

export interface AnalysisResult {
  durationSec: number;
  tempoMode: "fixed" | "variable";
  bpm: number | null;
  gridOffsetSec: number;
  beats: number[];
  downbeatPhase: 0 | 1 | 2 | 3;
  tempoMap: TempoPoint[];
  key: { global: KeyGuess; perSection: KeyGuess[] };
  sections: SectionInfo[];
  hits: HitInfo[];
  silences: SilenceInfo[];
  envelopes: Envelopes;
}

export interface EngineResult {
  analysis: AnalysisResult;
  warnings: string[];
}

/** セクション編集操作。
 *  index の規則(重要): move/rename/recolor/delete の index は「元の
 *  analysis.sections の添字」を指す。add で増えた分は
 *  index = 元の sections の長さ + 追加順(0起点) で参照する。
 *  適用順序やソートで添字が変わっても、常にこの「元添字」で指す。 */
export type SectionEdit =
  | { op: "move"; index: number; startSec: number }
  | { op: "rename"; index: number; label: string }
  | { op: "recolor"; index: number; color: string }
  | { op: "add"; startSec: number; label: string; color: string }
  | { op: "delete"; index: number };

export interface EditState {
  gridOffsetDeltaSec: number;
  bpmOverride?: number;        // タップテンポ / 半分 / 2倍(固定グリッドを再生成)
  beatsPerBar: number;         // 4/4=4, 3/4=3, 6/8=6
  downbeatShift: number;       // 1拍目ずらし(整数、正=後ろへ)
  gridAnchor?: { timeSec: number; freeBefore: boolean }; // 小節1アンカー(§3.3)
  sectionEdits: SectionEdit[];
  hitThreshold: { low: number; mid: number; high: number }; // 0〜1、これ未満を除外
  silenceThreshold: { db: number; minDurSec: number };
  customMarkers: Marker[];
  deletedMarkerIds: string[];
}

/** エクスポート 1 回分の設定(UI が組み立てて渡す) */
export interface ExportContext {
  fps: Fps;
  rounding: RoundingMode;
  include: MarkerType[];       // 書き出すマーカー種別
  baseName: string;            // 元ファイル名(拡張子抜き)
  sourceLabel: string | null;  // マルチソース時のソース名(単一なら null)
  audioFileName: string;       // AE/Blender が参照する音声ファイル名(例 "track.wav")
  audioDurationSec: number;
  bpmLabel: string;            // 表示用 "128.00" / "可変"
  keyLabel: string;            // 表示用 "E minor (9A)"
  beatsPerBar: number;         // MIDI拍子イベント用(edits.beatsPerBar と同値を渡す)
  tempoMap: TempoPoint[];      // MIDIテンポトラック用(bpmOverride時はUIが1点に差し替え)
  envelopes: Envelopes | null; // AEエンベロープ焼き込み用(書き出さないときは null)
}
```

`app/src/shared/validate.ts`:

```ts
/** エンジン JSON の読み込み口。ここだけが unknown/any を扱い、以降は型が保証される。 */
import type { AnalysisResult, EditState, EngineResult } from "./types.js";

export class ValidationError extends Error {}

/** fail() は常に throw する(never)。以降の型ナローイングがこの性質に依存して
 *  いるため、ログして続行する実装に変えてはならない。 */
function fail(msg: string): never {
  throw new ValidationError(`engine result invalid: ${msg}`);
}

function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function numArray(x: unknown, name: string): number[] {
  if (!Array.isArray(x) || !x.every(isNum)) fail(`${name} must be number[]`);
  return x as number[];
}

export function parseEngineResult(jsonText: string): EngineResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    fail(`not JSON: ${e}`);
  }
  const obj = raw as Record<string, unknown>;
  const a = obj["analysis"] as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object") fail("missing analysis");
  const warnings = obj["warnings"];
  if (!Array.isArray(warnings) || !warnings.every((w) => typeof w === "string")) {
    fail("missing warnings");
  }

  if (!isNum(a["durationSec"])) fail("durationSec");
  if (a["tempoMode"] !== "fixed" && a["tempoMode"] !== "variable") fail("tempoMode");
  if (a["bpm"] !== null && !isNum(a["bpm"])) fail("bpm");
  if (!isNum(a["gridOffsetSec"])) fail("gridOffsetSec");
  numArray(a["beats"], "beats");
  if (![0, 1, 2, 3].includes(a["downbeatPhase"] as number)) fail("downbeatPhase");
  if (!Array.isArray(a["tempoMap"])) fail("tempoMap");
  const key = a["key"] as Record<string, unknown> | undefined;
  if (!key || typeof key !== "object" || !key["global"] || !Array.isArray(key["perSection"])) {
    fail("key");
  }
  if (!Array.isArray(a["sections"])) fail("sections");
  if (!Array.isArray(a["hits"])) fail("hits");
  if (!Array.isArray(a["silences"])) fail("silences");
  const env = a["envelopes"] as Record<string, unknown> | undefined;
  if (!env || !isNum(env["sampleRateHz"])) fail("envelopes");
  for (const band of ["total", "low", "mid", "high"]) {
    numArray(env[band], `envelopes.${band}`);
  }

  return { analysis: a as unknown as AnalysisResult, warnings: warnings as string[] };
}

export function defaultEditState(): EditState {
  return {
    gridOffsetDeltaSec: 0,
    beatsPerBar: 4,
    downbeatShift: 0,
    sectionEdits: [],
    hitThreshold: { low: 0, mid: 0, high: 0 },
    silenceThreshold: { db: -45, minDurSec: 0.7 },
    customMarkers: [],
    deletedMarkerIds: [],
  };
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `npx vitest run src/shared/__tests__/validate.test.ts`
Expected: 4 passed

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
cd /home/claude/beatmarks
git add app/
git commit -m "feat(app): sharedライブラリの土台(型定義・バリデータ・エンジンfixture)"
```

---

### Task 2: タイムベース (timebase) — fps・フレーム・タイムコード

**Files:**
- Create: `app/src/shared/timebase.ts`
- Test: `app/src/shared/__tests__/timebase.test.ts`

**Interfaces:**
- Consumes: `types.Fps`, `types.RoundingMode`
- Produces:
  - `FPS_PRESETS: Record<string, Fps>` — キー: `"23.976" | "24" | "25" | "29.97" | "30" | "50" | "59.94" | "60"`(23.976={24000,1001}, 29.97={30000,1001}, 59.94={60000,1001}, 他は den:1)
  - `fpsValue(fps: Fps): number`
  - `fpsLabel(fps: Fps): string` — プリセットは "29.97" 形式、その他は小数 3 桁
  - `timeToFrame(timeSec: number, fps: Fps, rounding: RoundingMode): number`
  - `frameToTime(frame: number, fps: Fps): number`
  - `formatTimecode(frame: number, fps: Fps): string` — **ノンドロップ**。TC ベースは `ceil(num/den)`(29.97→30)。`HH:MM:SS:FF`
  - `formatSeconds(timeSec: number): string` — `"12.345"`(ms 精度 3 桁固定)

- [ ] **Step 1: 失敗するテストを書く**

`app/src/shared/__tests__/timebase.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  FPS_PRESETS, fpsValue, fpsLabel,
  timeToFrame, frameToTime, formatTimecode, formatSeconds,
} from "../timebase.js";

describe("FPS_PRESETS", () => {
  it("NTSC系は分数で表現される", () => {
    expect(FPS_PRESETS["29.97"]).toEqual({ num: 30000, den: 1001 });
    expect(FPS_PRESETS["23.976"]).toEqual({ num: 24000, den: 1001 });
    expect(FPS_PRESETS["59.94"]).toEqual({ num: 60000, den: 1001 });
    expect(FPS_PRESETS["30"]).toEqual({ num: 30, den: 1 });
  });
});

describe("timeToFrame / frameToTime", () => {
  it("30fpsの基本変換", () => {
    expect(timeToFrame(1.0, FPS_PRESETS["30"]!, "nearest")).toBe(30);
    expect(timeToFrame(59.999, FPS_PRESETS["30"]!, "nearest")).toBe(1800);
    expect(timeToFrame(0.9999, FPS_PRESETS["30"]!, "floor")).toBe(29);
    expect(frameToTime(30, FPS_PRESETS["30"]!)).toBeCloseTo(1.0, 12);
  });

  it("29.97はround(t*30000/1001)と厳密一致", () => {
    const fps = FPS_PRESETS["29.97"]!;
    for (const t of [0, 0.5, 1, 10, 59.94, 123.456, 600]) {
      expect(timeToFrame(t, fps, "nearest")).toBe(Math.round((t * 30000) / 1001));
      expect(timeToFrame(t, fps, "floor")).toBe(Math.floor((t * 30000) / 1001));
    }
  });

  it("29.97で10分・0.5s刻みでも累積誤差なし(単調・重複/飛びが想定どおり)", () => {
    const fps = FPS_PRESETS["29.97"]!;
    let prev = -1;
    for (let i = 0; i <= 1200; i++) {
      const t = i * 0.5;
      const f = timeToFrame(t, fps, "nearest");
      const expected = Math.round((t * 30000) / 1001);
      expect(f).toBe(expected);           // 都度丸め=真値。累積計算をしていない証明
      expect(f).toBeGreaterThan(prev);    // 0.5s刻み(≈14.985f)は単調増加
      prev = f;
    }
    // 10分地点: 600s * 29.97002997 ≈ 17982.0…
    expect(timeToFrame(600, fps, "nearest")).toBe(Math.round((600 * 30000) / 1001));
  });

  it("負や極小の時刻も安全", () => {
    expect(timeToFrame(0, FPS_PRESETS["24"]!, "nearest")).toBe(0);
    expect(timeToFrame(-0.0001, FPS_PRESETS["24"]!, "nearest")).toBe(0); // 0未満は0へクランプ
  });
});

describe("formatTimecode(ノンドロップ)", () => {
  it("30fps", () => {
    expect(formatTimecode(0, FPS_PRESETS["30"]!)).toBe("00:00:00:00");
    expect(formatTimecode(29, FPS_PRESETS["30"]!)).toBe("00:00:00:29");
    expect(formatTimecode(30, FPS_PRESETS["30"]!)).toBe("00:00:01:00");
    expect(formatTimecode(1800, FPS_PRESETS["30"]!)).toBe("00:01:00:00");
    expect(formatTimecode(30 * 3600, FPS_PRESETS["30"]!)).toBe("01:00:00:00");
  });

  it("29.97はTCベース30のノンドロップ", () => {
    const fps = FPS_PRESETS["29.97"]!;
    expect(formatTimecode(30, fps)).toBe("00:00:01:00");
    expect(formatTimecode(17982, fps)).toBe("00:09:59:12"); // 17982 = 599*30+12
  });

  it("23.976はTCベース24", () => {
    expect(formatTimecode(24, FPS_PRESETS["23.976"]!)).toBe("00:00:01:00");
  });
});

describe("ラベル整形", () => {
  it("fpsValue / fpsLabel", () => {
    expect(fpsValue(FPS_PRESETS["29.97"]!)).toBeCloseTo(29.97002997, 6);
    expect(fpsLabel(FPS_PRESETS["29.97"]!)).toBe("29.97");
    expect(fpsLabel({ num: 48, den: 1 })).toBe("48");
  });

  it("formatSeconds はms 3桁固定", () => {
    expect(formatSeconds(1.5)).toBe("1.500");
    expect(formatSeconds(0)).toBe("0.000");
    expect(formatSeconds(12.3456)).toBe("12.346");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/__tests__/timebase.test.ts`
Expected: FAIL — `Cannot find module '../timebase.js'`

- [ ] **Step 3: 実装**

`app/src/shared/timebase.ts`:

```ts
/** fps・フレーム・タイムコード変換。fps は常に分数 {num, den} で厳密計算する。
 *  frame = round(t * num / den) — 都度計算のため累積誤差なし(スペック §6)。
 *  タイムコードはノンドロップ既定(スペック §6)。 */
import type { Fps, RoundingMode } from "./types.js";

export const FPS_PRESETS: Record<string, Fps> = {
  "23.976": { num: 24000, den: 1001 },
  "24": { num: 24, den: 1 },
  "25": { num: 25, den: 1 },
  "29.97": { num: 30000, den: 1001 },
  "30": { num: 30, den: 1 },
  "50": { num: 50, den: 1 },
  "59.94": { num: 60000, den: 1001 },
  "60": { num: 60, den: 1 },
};

export function fpsValue(fps: Fps): number {
  return fps.num / fps.den;
}

export function fpsLabel(fps: Fps): string {
  for (const [label, preset] of Object.entries(FPS_PRESETS)) {
    if (preset.num === fps.num && preset.den === fps.den) return label;
  }
  const v = fpsValue(fps);
  return Number.isInteger(v) ? String(v) : v.toFixed(3);
}

export function timeToFrame(timeSec: number, fps: Fps, rounding: RoundingMode): number {
  const exact = (timeSec * fps.num) / fps.den;
  const frame = rounding === "floor" ? Math.floor(exact) : Math.round(exact);
  return Math.max(0, frame);
}

export function frameToTime(frame: number, fps: Fps): number {
  return (frame * fps.den) / fps.num;
}

/** ノンドロップTC。ベースフレームレート = ceil(num/den)(29.97→30, 23.976→24)。 */
export function formatTimecode(frame: number, fps: Fps): string {
  const base = Math.ceil(fps.num / fps.den);
  const ff = frame % base;
  const totalSec = Math.floor(frame / base);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

export function formatSeconds(timeSec: number): string {
  return timeSec.toFixed(3);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/__tests__/timebase.test.ts && npx tsc --noEmit`
Expected: 9 passed、型エラーなし

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/timebase.ts app/src/shared/__tests__/timebase.test.ts
git commit -m "feat(app): タイムベース(分数fps・フレーム変換・ノンドロップTC)"
```

---

### Task 3: エンベロープ再サンプルと静寂の再フィルタ (envelope)

**Files:**
- Create: `app/src/shared/envelope.ts`
- Test: `app/src/shared/__tests__/envelope.test.ts`

**Interfaces:**
- Consumes: `types.Envelopes`, `types.SilenceInfo`, `types.Fps`, `timebase.timeToFrame/frameToTime`
- Produces:
  - `normToDb(norm: number): number` — エンジンの正規化(−60〜0dB → 0〜1)の逆変換 `norm*60-60`
  - `detectSilencesFromEnvelope(total: number[], rateHz: number, thresholdDb: number, minDurSec: number): SilenceInfo[]` — エンジン `detect_silences` と同一アルゴリズムの TS 版(しきい値変更を再解析なしで反映する仕組み。スペック §5)
  - `resampleEnvelopeToFps(env: number[], rateHz: number, fps: Fps, durationSec: number): number[]` — フレームごとの値(線形補間)。長さ = `timeToFrame(durationSec, fps, "floor") + 1`

- [ ] **Step 1: 失敗するテストを書く**

`app/src/shared/__tests__/envelope.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { detectSilencesFromEnvelope, normToDb, resampleEnvelopeToFps } from "../envelope.js";
import { FPS_PRESETS } from "../timebase.js";

describe("normToDb", () => {
  it("正規化の逆変換", () => {
    expect(normToDb(1)).toBe(0);
    expect(normToDb(0.25)).toBe(-45);
    expect(normToDb(0)).toBe(-60);
  });
});

describe("detectSilencesFromEnvelope", () => {
  // 100Hz: 1秒音(0.5) / 1秒静寂(0.1 ≈ -54dB) / 1秒音(0.5)
  const total = [
    ...Array(100).fill(0.5),
    ...Array(100).fill(0.1),
    ...Array(100).fill(0.5),
  ] as number[];

  it("既定しきい値(-45dB/0.7s)で1リージョン検出", () => {
    const regions = detectSilencesFromEnvelope(total, 100, -45, 0.7);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.startSec).toBeCloseTo(1.0, 6);
    expect(regions[0]!.endSec).toBeCloseTo(2.0, 6);
    expect(regions[0]!.floorDb).toBeCloseTo(-54, 6);
  });

  it("minDurを2秒にすると検出されない(再解析なしの再フィルタ)", () => {
    expect(detectSilencesFromEnvelope(total, 100, -45, 2.0)).toHaveLength(0);
  });

  it("しきい値を-70dBに下げると検出されない", () => {
    expect(detectSilencesFromEnvelope(total, 100, -70, 0.7)).toHaveLength(0);
  });

  it("末尾まで静寂が続くケース", () => {
    const t = [...Array(50).fill(0.5), ...Array(150).fill(0.05)] as number[];
    const regions = detectSilencesFromEnvelope(t, 100, -45, 0.7);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.endSec).toBeCloseTo(2.0, 6);
  });
});

describe("resampleEnvelopeToFps", () => {
  it("長さ = floorフレーム+1、値は線形補間", () => {
    // 100Hzで0..1へ線形に上がる2秒のエンベロープ
    const env = Array.from({ length: 200 }, (_, i) => i / 199);
    const out = resampleEnvelopeToFps(env, 100, FPS_PRESETS["30"]!, 2.0);
    expect(out).toHaveLength(61); // floor(2*30)+1
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[30]!).toBeCloseTo(env[100]!, 2); // t=1.0
    expect(out[60]!).toBeCloseTo(1, 2);
    for (const v of out) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("29.97でも長さが分数計算で正しい", () => {
    const env = Array(300).fill(0.5) as number[];
    const out = resampleEnvelopeToFps(env, 100, FPS_PRESETS["29.97"]!, 3.0);
    expect(out).toHaveLength(Math.floor((3.0 * 30000) / 1001) + 1); // 89+1
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-9)).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/__tests__/envelope.test.ts`
Expected: FAIL — `Cannot find module '../envelope.js'`

- [ ] **Step 3: 実装**

`app/src/shared/envelope.ts`:

```ts
/** エンベロープ(100Hz正規化系列)のフレーム再サンプルと、静寂の再フィルタ。
 *  エンジンは既定しきい値の silences と生の envelope を返す。しきい値を UI で
 *  変えたときはここで envelope から再導出する(再解析不要。スペック §5)。 */
import { frameToTime, timeToFrame } from "./timebase.js";
import type { Fps, SilenceInfo } from "./types.js";

export function normToDb(norm: number): number {
  return norm * 60 - 60;
}

export function detectSilencesFromEnvelope(
  total: number[], rateHz: number, thresholdDb: number, minDurSec: number,
): SilenceInfo[] {
  const regions: SilenceInfo[] = [];
  let start: number | null = null;
  let minDb = Infinity;

  const push = (a: number, b: number, floor: number) => {
    if ((b - a) / rateHz >= minDurSec) {
      regions.push({ startSec: a / rateHz, endSec: b / rateHz, floorDb: floor });
    }
  };

  for (let i = 0; i < total.length; i++) {
    const db = normToDb(total[i]!);
    if (db < thresholdDb) {
      if (start === null) {
        start = i;
        minDb = db;
      } else if (db < minDb) {
        minDb = db;
      }
    } else if (start !== null) {
      push(start, i, minDb);
      start = null;
      minDb = Infinity;
    }
  }
  if (start !== null) push(start, total.length, minDb);
  return regions;
}

/** フレーム0..N(N = floor(dur×fps))ごとにエンベロープ値を線形補間で返す。 */
export function resampleEnvelopeToFps(
  env: number[], rateHz: number, fps: Fps, durationSec: number,
): number[] {
  const lastFrame = timeToFrame(durationSec, fps, "floor");
  const out: number[] = new Array(lastFrame + 1);
  for (let f = 0; f <= lastFrame; f++) {
    const t = frameToTime(f, fps);
    const x = t * rateHz;
    const i = Math.floor(x);
    const frac = x - i;
    const a = env[Math.min(i, env.length - 1)] ?? 0;
    const b = env[Math.min(i + 1, env.length - 1)] ?? a;
    out[f] = a + (b - a) * frac;
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/__tests__/envelope.test.ts && npx tsc --noEmit`
Expected: 7 passed、型エラーなし

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/envelope.ts app/src/shared/__tests__/envelope.test.ts
git commit -m "feat(app): エンベロープ再サンプルと静寂の再フィルタ"
```

---

### Task 4: 編集適用後のグリッド導出 (deriveGrid)

**Files:**
- Create: `app/src/shared/deriveGrid.ts`
- Test: `app/src/shared/__tests__/deriveGrid.test.ts`

**Interfaces:**
- Consumes: `types.AnalysisResult`, `types.EditState`
- Produces:
  - `GridBeat { timeSec: number; index: number; isBar: boolean; barNumber: number; free: boolean }`
  - `deriveGrid(analysis: AnalysisResult, edits: EditState): GridBeat[]` — 適用順:
    1. `bpmOverride` があれば固定グリッドを再生成(周期 60/bpm、位相 = `analysis.gridOffsetSec`)。なければ `analysis.beats` を使用(fixed でも variable でも)
    2. 全拍に `gridOffsetDeltaSec` を加算し、`[0, durationSec)` 外はドロップ
    3. 1拍目位相 = `(analysis.downbeatPhase + edits.downbeatShift) mod beatsPerBar`(負値は正に正規化)。小節番号は位相起点で 1,2,3…(位相より前の拍は小節0扱い)
    4. `gridAnchor` があれば位相を上書き: アンカー時刻に最も近い拍を「小節1・拍1」とし、小節頭はそこから±beatsPerBar 間隔。アンカーより前は `barNumber = 0, -1, …` と遡る。`freeBefore: true` ならアンカーより前の拍を `free: true` にする(マーカー化しない印。スペック §3.3)
  - `barsOf(grid: GridBeat[]): GridBeat[]` — `isBar && !free` のみ

- [ ] **Step 1: 失敗するテストを書く**

`app/src/shared/__tests__/deriveGrid.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { deriveGrid, barsOf } from "../deriveGrid.js";
import { defaultEditState } from "../validate.js";
import type { AnalysisResult, EditState } from "../types.js";

/** 固定120BPM・オフセット0.25s・10秒(拍0.25,0.75,…,9.75 の20拍)の合成解析結果 */
function fixedAnalysis(): AnalysisResult {
  const beats = Array.from({ length: 20 }, (_, i) => 0.25 + i * 0.5);
  return {
    durationSec: 10,
    tempoMode: "fixed",
    bpm: 120,
    gridOffsetSec: 0.25,
    beats,
    downbeatPhase: 0,
    tempoMap: [{ timeSec: 0, bpm: 120 }],
    key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [],
    hits: [],
    silences: [],
    envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
  };
}

function edits(over: Partial<EditState> = {}): EditState {
  return { ...defaultEditState(), ...over };
}

describe("deriveGrid 基本", () => {
  it("編集なし: 4/4で位相0、小節頭は0.25/2.25/4.25…", () => {
    const grid = deriveGrid(fixedAnalysis(), edits());
    expect(grid).toHaveLength(20);
    const bars = barsOf(grid);
    expect(bars.map((b) => b.timeSec)).toEqual([0.25, 2.25, 4.25, 6.25, 8.25]);
    expect(bars.map((b) => b.barNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(grid[1]!.isBar).toBe(false);
    expect(grid[1]!.barNumber).toBe(1); // 小節1内の拍
    expect(grid.every((b) => !b.free)).toBe(true);
  });

  it("gridOffsetDeltaSecで全拍がシフト", () => {
    const grid = deriveGrid(fixedAnalysis(), edits({ gridOffsetDeltaSec: 0.1 }));
    expect(grid[0]!.timeSec).toBeCloseTo(0.35, 9);
    expect(grid).toHaveLength(20); // 9.85 < 10 なので落ちない
  });

  it("downbeatShiftで小節頭が1拍ずれる", () => {
    const bars = barsOf(deriveGrid(fixedAnalysis(), edits({ downbeatShift: 1 })));
    expect(bars[0]!.timeSec).toBeCloseTo(0.75, 9);
  });

  it("beatsPerBar=3で3拍ごとの小節頭", () => {
    const bars = barsOf(deriveGrid(fixedAnalysis(), edits({ beatsPerBar: 3 })));
    expect(bars.map((b) => b.timeSec).slice(0, 3)).toEqual([0.25, 1.75, 3.25]);
  });

  it("bpmOverride=240で拍数が倍になる", () => {
    const grid = deriveGrid(fixedAnalysis(), edits({ bpmOverride: 240 }));
    expect(grid.length).toBe(39); // 0.25 + k*0.25 < 10 → k=0..38
    expect(grid[1]!.timeSec).toBeCloseTo(0.5, 9);
  });

  it("負のdownbeatShiftも正規化される", () => {
    const bars = barsOf(deriveGrid(fixedAnalysis(), edits({ downbeatShift: -1 })));
    // phase (0-1) mod 4 = 3 → 最初の小節頭は index3 = 1.75
    expect(bars[0]!.timeSec).toBeCloseTo(1.75, 9);
  });
});

describe("小節1アンカー", () => {
  it("アンカー位置の拍が小節1・拍1になり前は小節0以下", () => {
    const grid = deriveGrid(
      fixedAnalysis(),
      edits({ gridAnchor: { timeSec: 4.3, freeBefore: false } }),
    );
    const anchor = grid.find((b) => b.barNumber === 1 && b.isBar)!;
    expect(anchor.timeSec).toBeCloseTo(4.25, 9); // 4.3に最も近い拍
    const before = grid.filter((b) => b.timeSec < 4.25 && b.isBar);
    expect(before.map((b) => b.barNumber)).toEqual([-1, 0]); // 0.25=小節-1, 2.25=小節0
    expect(grid.every((b) => !b.free)).toBe(true);
  });

  it("freeBefore=trueでアンカー前がfreeになる", () => {
    const grid = deriveGrid(
      fixedAnalysis(),
      edits({ gridAnchor: { timeSec: 4.3, freeBefore: true } }),
    );
    for (const b of grid) {
      expect(b.free).toBe(b.timeSec < 4.25 - 1e-9);
    }
    expect(barsOf(grid)[0]!.timeSec).toBeCloseTo(4.25, 9);
  });

  it("アンカーはdownbeatShiftより優先される", () => {
    const g1 = deriveGrid(
      fixedAnalysis(),
      edits({ gridAnchor: { timeSec: 4.3, freeBefore: false }, downbeatShift: 2 }),
    );
    expect(g1.find((b) => b.barNumber === 1 && b.isBar)!.timeSec).toBeCloseTo(4.25, 9);
  });
});

describe("可変テンポ", () => {
  it("beatsをそのまま使いbarNumberを振る", () => {
    const a = fixedAnalysis();
    a.tempoMode = "variable";
    a.bpm = null;
    a.beats = [0.5, 1.0, 1.6, 2.3, 3.1, 4.0]; // 不等間隔
    const grid = deriveGrid(a, edits());
    expect(grid.map((b) => b.timeSec)).toEqual(a.beats);
    expect(barsOf(grid).map((b) => b.timeSec)).toEqual([0.5, 3.1]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/__tests__/deriveGrid.test.ts`
Expected: FAIL — `Cannot find module '../deriveGrid.js'`

- [ ] **Step 3: 実装**

`app/src/shared/deriveGrid.ts`:

```ts
/** 解析結果+編集(EditState)から表示・書き出し用の拍/小節グリッドを導出する。
 *  エンジンは生の拍列と位相だけを返す設計(計画①の責務境界)。ここが
 *  bpmOverride / オフセット / 拍子 / 1拍目ずらし / 小節1アンカーを適用する。 */
import type { AnalysisResult, EditState } from "./types.js";

export interface GridBeat {
  timeSec: number;
  index: number;      // 適用後グリッド内の拍番号(0起点)
  isBar: boolean;
  barNumber: number;  // アンカーより前は 0, -1, … になりうる
  free: boolean;      // true = マーカー化しない(アンカー前のフリー区間)
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function deriveGrid(analysis: AnalysisResult, edits: EditState): GridBeat[] {
  const dur = analysis.durationSec;
  const bpb = Math.max(1, Math.floor(edits.beatsPerBar));

  // 1) 基礎拍列
  let times: number[];
  if (edits.bpmOverride && edits.bpmOverride > 0) {
    const period = 60 / edits.bpmOverride;
    times = [];
    for (let t = analysis.gridOffsetSec; t < dur; t += period) times.push(t);
  } else {
    times = [...analysis.beats];
  }

  // 2) オフセット微調整
  times = times
    .map((t) => t + edits.gridOffsetDeltaSec)
    .filter((t) => t >= 0 && t < dur);

  if (times.length === 0) return [];

  // 3) 位相(アンカーなし時)
  //    bpmOverride でグリッドを作り直した場合、元の downbeatPhase は元の拍列に
  //    対する位相なので厳密には無効だが、「近い拍に引き継ぐ」より 0 起点で
  //    振り直し+ユーザーが1拍目ずらしで合わせる方が予測可能なので phase を
  //    そのまま流用する(shift で補正可能)。
  let anchorIndex: number;
  if (edits.gridAnchor) {
    // 4) アンカー: 最も近い拍が小節1・拍1
    let best = 0;
    for (let i = 1; i < times.length; i++) {
      if (Math.abs(times[i]! - edits.gridAnchor.timeSec) <
          Math.abs(times[best]! - edits.gridAnchor.timeSec)) best = i;
    }
    anchorIndex = best;
  } else {
    anchorIndex = mod(analysis.downbeatPhase + edits.downbeatShift, bpb);
  }

  const freeBefore = edits.gridAnchor?.freeBefore ?? false;
  const anchorTime = times[anchorIndex]!;

  return times.map((t, i) => {
    const rel = i - anchorIndex;
    const isBar = mod(rel, bpb) === 0;
    const barNumber = Math.floor(rel / bpb) + 1;
    const free = freeBefore && t < anchorTime - 1e-9;
    return { timeSec: t, index: i, isBar, barNumber, free };
  });
}

export function barsOf(grid: GridBeat[]): GridBeat[] {
  return grid.filter((b) => b.isBar && !b.free);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/__tests__/deriveGrid.test.ts && npx tsc --noEmit`
Expected: 10 passed、型エラーなし

(注: `編集なし` テストの「小節1内の拍の barNumber=1」は `anchorIndex=位相` の実装で自然に満たされる — index1 の rel=1、floor(1/4)+1=1)

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/deriveGrid.ts app/src/shared/__tests__/deriveGrid.test.ts
git commit -m "feat(app): 拍/小節グリッド導出(bpm上書き・拍子・1拍目ずらし・小節1アンカー)"
```

> **レビュー後の強化(2026-07-12 適用済み、commit 0088130)**: 上記サンプルに加えて入力サニタイズが入っている — bpmOverride は非有限/0以下を「上書きなし」扱い+period下限10ms(タップテンポΔt≈0での無限ループ防止)、downbeatShift は round、beatsPerBar は NaN→4、anchorTime は `number | undefined` 化。実装はこの強化込みが正。

---

### Task 5: 最終マーカー列の組み立て (deriveMarkers)

**Files:**
- Create: `app/src/shared/deriveMarkers.ts`
- Test: `app/src/shared/__tests__/deriveMarkers.test.ts`

**Interfaces:**
- Consumes: `deriveGrid.deriveGrid/barsOf`, `envelope.detectSilencesFromEnvelope`, `types.*`
- Produces:
  - `SECTION_COLORS: string[]`(8色パレット)/ `HIT_COLORS: Record<Band, string>` / `SILENCE_COLOR: string` / `BEAT_COLOR: string` / `BAR_COLOR: string`
  - `deriveMarkers(analysis: AnalysisResult, edits: EditState, sourceId: string): Marker[]` — 仕様:
    - **beat**: グリッドの全拍(free 除く)。id `beat-{index}`、ラベル `拍`
    - **bar**: 小節頭(free 除く)。id `bar-{barNumber}`、ラベル `小節{barNumber}`、`meta.barNumber`
    - **section**: `analysis.sections` に `sectionEdits` を適用(move/rename/recolor/add/delete。move/rename/recolor/delete の `index` は元 sections の添字、add 分は `元の長さ+追加順` で参照)→ startSec でソートし直し、先頭 start=0・各 endSec=次の start(末尾は durationSec)に再計算。id `sec-{適用後index}`、`meta.durationSec`。色は `SECTION_COLORS[clusterId % 8]`(add は指定色)、`chorusCandidate` はラベル末尾に `" ★"`(rename されていなければ)
    - **hit**: `strength >= hitThreshold[band]` のみ。id `hit-{band}-{元配列index}`、ラベル = band、`meta.{strength, band}`
    - **silence**: `analysis.silences` ではなく **envelopes.total から `edits.silenceThreshold` で再導出**。各リージョンにつき 2 マーカー: id `sil-{i}-in`(ラベル `静寂IN`、`meta.durationSec` = リージョン長)と id `sil-{i}-out`(ラベル `静寂OUT`、endSec 位置)
    - **custom**: `edits.customMarkers` をそのまま(sourceId は上書き)
    - 最後に `deletedMarkerIds` に載っている id を全種別から除外し、`timeSec` 昇順(同時刻は section→bar→beat→hit→silence→custom の順)でソート
    - 全マーカーの `sourceId` は引数の値、`source` は auto(custom のみ user)

- [ ] **Step 1: 失敗するテストを書く**

`app/src/shared/__tests__/deriveMarkers.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { deriveMarkers, SECTION_COLORS } from "../deriveMarkers.js";
import { defaultEditState } from "../validate.js";
import type { AnalysisResult, EditState, Marker } from "../types.js";

function analysis(): AnalysisResult {
  const beats = Array.from({ length: 20 }, (_, i) => 0.25 + i * 0.5);
  // 100Hz 10秒: 4.0〜5.2s だけ -54dB(norm 0.1)
  const total = Array.from({ length: 1000 }, (_, i) =>
    i >= 400 && i < 520 ? 0.1 : 0.5,
  );
  return {
    durationSec: 10,
    tempoMode: "fixed",
    bpm: 120,
    gridOffsetSec: 0.25,
    beats,
    downbeatPhase: 0,
    tempoMap: [{ timeSec: 0, bpm: 120 }],
    key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [
      { startSec: 0, endSec: 4.25, label: "A", clusterId: 0, chorusCandidate: false },
      { startSec: 4.25, endSec: 10, label: "B", clusterId: 1, chorusCandidate: true },
    ],
    hits: [
      { timeSec: 0.25, band: "low", strength: 0.9 },
      { timeSec: 0.75, band: "low", strength: 0.3 },
      { timeSec: 1.0, band: "high", strength: 0.5 },
    ],
    silences: [], // 意図的に空(deriveはenvelopeから再導出する)
    envelopes: { sampleRateHz: 100, total, low: total, mid: total, high: total },
  };
}

function edits(over: Partial<EditState> = {}): EditState {
  return { ...defaultEditState(), ...over };
}

const byType = (ms: Marker[], t: Marker["type"]) => ms.filter((m) => m.type === t);

describe("deriveMarkers 基本", () => {
  it("全種別が生成され、時刻順に並ぶ", () => {
    const ms = deriveMarkers(analysis(), edits(), "src-1");
    expect(byType(ms, "beat")).toHaveLength(20);
    expect(byType(ms, "bar")).toHaveLength(5);
    expect(byType(ms, "section")).toHaveLength(2);
    expect(byType(ms, "hit")).toHaveLength(3);
    expect(byType(ms, "silence")).toHaveLength(2); // IN/OUT
    const times = ms.map((m) => m.timeSec);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(ms.every((m) => m.sourceId === "src-1")).toBe(true);
  });

  it("セクションは色パレット+サビ候補に★", () => {
    const secs = byType(deriveMarkers(analysis(), edits(), "s"), "section");
    expect(secs[0]!.color).toBe(SECTION_COLORS[0]);
    expect(secs[0]!.label).toBe("A");
    expect(secs[1]!.label).toBe("B ★");
    expect(secs[0]!.meta?.durationSec).toBeCloseTo(4.25, 9);
    expect(secs[1]!.meta?.durationSec).toBeCloseTo(5.75, 9);
  });

  it("小節マーカーはbarNumberを持つ", () => {
    const bars = byType(deriveMarkers(analysis(), edits(), "s"), "bar");
    expect(bars[0]!.label).toBe("小節1");
    expect(bars[0]!.meta?.barNumber).toBe(1);
  });
});

describe("しきい値フィルタ", () => {
  it("hitThresholdで帯域別に足切り(再解析なし)", () => {
    const ms = deriveMarkers(analysis(), edits({ hitThreshold: { low: 0.5, mid: 0, high: 0 } }), "s");
    const hits = byType(ms, "hit");
    expect(hits).toHaveLength(2); // low 0.3 が落ちる
    expect(hits.every((h) => h.meta!.band !== "low" || h.meta!.strength! >= 0.5)).toBe(true);
  });

  it("silenceThresholdはenvelopeから再導出される", () => {
    const base = deriveMarkers(analysis(), edits(), "s");
    const inMarker = byType(base, "silence").find((m) => m.label === "静寂IN")!;
    expect(inMarker.timeSec).toBeCloseTo(4.0, 6);
    expect(inMarker.meta?.durationSec).toBeCloseTo(1.2, 6);
    const out = byType(base, "silence").find((m) => m.label === "静寂OUT")!;
    expect(out.timeSec).toBeCloseTo(5.2, 6);
    // minDurを2sにすると消える
    const none = deriveMarkers(
      analysis(), edits({ silenceThreshold: { db: -45, minDurSec: 2 } }), "s",
    );
    expect(byType(none, "silence")).toHaveLength(0);
  });
});

describe("セクション編集", () => {
  it("move: 境界移動で隣接endSecも再計算", () => {
    const ms = deriveMarkers(
      analysis(), edits({ sectionEdits: [{ op: "move", index: 1, startSec: 6.25 }] }), "s",
    );
    const secs = byType(ms, "section");
    expect(secs[0]!.meta?.durationSec).toBeCloseTo(6.25, 9);
    expect(secs[1]!.timeSec).toBeCloseTo(6.25, 9);
  });

  it("rename/recolorは★より優先", () => {
    const ms = deriveMarkers(
      analysis(),
      edits({ sectionEdits: [
        { op: "rename", index: 1, label: "サビ" },
        { op: "recolor", index: 1, color: "#123456" },
      ] }),
      "s",
    );
    const sec = byType(ms, "section")[1]!;
    expect(sec.label).toBe("サビ"); // renameしたら★は付けない
    expect(sec.color).toBe("#123456");
  });

  it("add+delete: 追加分はindex=元の長さ+追加順で参照できる", () => {
    const ms = deriveMarkers(
      analysis(),
      edits({ sectionEdits: [
        { op: "add", startSec: 2.25, label: "間奏", color: "#888888" },
        { op: "delete", index: 0 },       // 元のA削除
        { op: "rename", index: 2, label: "間奏2" }, // 追加分(index=2)をrename
      ] }),
      "s",
    );
    const secs = byType(ms, "section");
    expect(secs.map((m) => m.label)).toEqual(["間奏2", "B ★"]);
    expect(secs[0]!.timeSec).toBe(0); // 先頭は常に0へ正規化
  });
});

describe("削除とカスタム", () => {
  it("deletedMarkerIdsは自動マーカーも消せる", () => {
    const all = deriveMarkers(analysis(), edits(), "s");
    const victim = all.find((m) => m.type === "bar")!;
    const ms = deriveMarkers(analysis(), edits({ deletedMarkerIds: [victim.id] }), "s");
    expect(ms.find((m) => m.id === victim.id)).toBeUndefined();
    expect(byType(ms, "bar")).toHaveLength(4);
  });

  it("customMarkersはsource=userでsourceIdが上書きされる", () => {
    const custom: Marker = {
      id: "custom-1", sourceId: "stale", timeSec: 7.77, type: "custom",
      label: "カメラフラッシュ", color: "#ffd166", source: "user",
    };
    const ms = deriveMarkers(analysis(), edits({ customMarkers: [custom] }), "s2");
    const got = ms.find((m) => m.id === "custom-1")!;
    expect(got.sourceId).toBe("s2");
    expect(got.source).toBe("user");
    expect(got.timeSec).toBe(7.77);
  });

  it("freeBeforeなアンカー前のbeat/barは出ない", () => {
    const ms = deriveMarkers(
      analysis(), edits({ gridAnchor: { timeSec: 4.3, freeBefore: true } }), "s",
    );
    const beats = byType(ms, "beat");
    expect(beats[0]!.timeSec).toBeCloseTo(4.25, 9);
    expect(byType(ms, "bar")[0]!.label).toBe("小節1");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/__tests__/deriveMarkers.test.ts`
Expected: FAIL — `Cannot find module '../deriveMarkers.js'`

- [ ] **Step 3: 実装**

`app/src/shared/deriveMarkers.ts`:

```ts
/** 解析+編集 → 最終マーカー列(単一ソース分)。エクスポータと UI が共有する唯一の導出点。 */
import { barsOf, deriveGrid } from "./deriveGrid.js";
import { detectSilencesFromEnvelope } from "./envelope.js";
import type { AnalysisResult, Band, EditState, Marker, SectionInfo } from "./types.js";

export const SECTION_COLORS = [
  "#5b7fd4", "#38a3a5", "#f4a259", "#e4547c",
  "#8d78d9", "#b56fd0", "#6b7686", "#4f8f6b",
] as const;
export const HIT_COLORS: Record<Band, string> = {
  low: "#ff7847", mid: "#ffd166", high: "#5ad1e6",
};
export const SILENCE_COLOR = "#6b7686";
export const BEAT_COLOR = "#8b94a3";
export const BAR_COLOR = "#e8ebf0";

const TYPE_ORDER: Record<Marker["type"], number> = {
  section: 0, bar: 1, beat: 2, hit: 3, silence: 4, custom: 5,
};

interface WorkingSection {
  startSec: number;
  label: string;
  color: string;
  renamed: boolean;
  chorusCandidate: boolean;
  deleted: boolean;
}

function applySectionEdits(analysis: AnalysisResult, edits: EditState): WorkingSection[] {
  const work: WorkingSection[] = analysis.sections.map((s: SectionInfo) => ({
    startSec: s.startSec,
    label: s.label,
    color: SECTION_COLORS[s.clusterId % SECTION_COLORS.length]!,
    renamed: false,
    chorusCandidate: s.chorusCandidate,
    deleted: false,
  }));
  for (const e of edits.sectionEdits) {
    if (e.op === "add") {
      work.push({
        startSec: e.startSec, label: e.label, color: e.color,
        renamed: true, chorusCandidate: false, deleted: false,
      });
      continue;
    }
    const target = work[e.index];
    if (!target) continue; // 不正indexは無視(UIのバグでも書き出しは壊さない)
    if (e.op === "move") target.startSec = e.startSec;
    else if (e.op === "rename") { target.label = e.label; target.renamed = true; }
    else if (e.op === "recolor") target.color = e.color;
    else if (e.op === "delete") target.deleted = true;
  }
  const alive = work.filter((w) => !w.deleted).sort((a, b) => a.startSec - b.startSec);
  if (alive.length > 0) alive[0]!.startSec = 0; // 先頭は常に曲頭
  return alive;
}

export function deriveMarkers(
  analysis: AnalysisResult, edits: EditState, sourceId: string,
): Marker[] {
  const out: Marker[] = [];
  const dur = analysis.durationSec;

  // beat / bar
  const grid = deriveGrid(analysis, edits);
  for (const b of grid) {
    if (b.free) continue;
    out.push({
      id: `beat-${b.index}`, sourceId, timeSec: b.timeSec, type: "beat",
      label: "拍", color: BEAT_COLOR, source: "auto",
    });
  }
  for (const b of barsOf(grid)) {
    out.push({
      id: `bar-${b.barNumber}`, sourceId, timeSec: b.timeSec, type: "bar",
      label: `小節${b.barNumber}`, color: BAR_COLOR, source: "auto",
      meta: { barNumber: b.barNumber },
    });
  }

  // section
  const sections = applySectionEdits(analysis, edits);
  sections.forEach((s, i) => {
    const end = i + 1 < sections.length ? sections[i + 1]!.startSec : dur;
    const label = s.chorusCandidate && !s.renamed ? `${s.label} ★` : s.label;
    out.push({
      id: `sec-${i}`, sourceId, timeSec: s.startSec, type: "section",
      label, color: s.color, source: "auto",
      meta: { durationSec: end - s.startSec },
    });
  });

  // hit(しきい値はUI側=ここで適用。スペック §3.2-5)
  analysis.hits.forEach((h, i) => {
    if (h.strength < edits.hitThreshold[h.band]) return;
    out.push({
      id: `hit-${h.band}-${i}`, sourceId, timeSec: h.timeSec, type: "hit",
      label: h.band, color: HIT_COLORS[h.band], source: "auto",
      meta: { strength: h.strength, band: h.band },
    });
  });

  // silence(envelopeから再導出。IN/OUTの2点。スペック §3.2-7)
  const silences = detectSilencesFromEnvelope(
    analysis.envelopes.total, analysis.envelopes.sampleRateHz,
    edits.silenceThreshold.db, edits.silenceThreshold.minDurSec,
  );
  silences.forEach((r, i) => {
    out.push({
      id: `sil-${i}-in`, sourceId, timeSec: r.startSec, type: "silence",
      label: "静寂IN", color: SILENCE_COLOR, source: "auto",
      meta: { durationSec: r.endSec - r.startSec },
    });
    out.push({
      id: `sil-${i}-out`, sourceId, timeSec: r.endSec, type: "silence",
      label: "静寂OUT", color: SILENCE_COLOR, source: "auto",
    });
  });

  // custom
  for (const c of edits.customMarkers) {
    out.push({ ...c, sourceId, source: "user" });
  }

  // 削除とソート
  const deleted = new Set(edits.deletedMarkerIds);
  return out
    .filter((m) => !deleted.has(m.id))
    .sort((a, b) => a.timeSec - b.timeSec || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/__tests__/deriveMarkers.test.ts && npx vitest run && npx tsc --noEmit`
Expected: このファイル 11 passed、全体もグリーン、型エラーなし

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/deriveMarkers.ts app/src/shared/__tests__/deriveMarkers.test.ts
git commit -m "feat(app): 最終マーカー列の導出(セクション編集・しきい値・静寂IN/OUT・削除)"
```

> **レビュー後の強化(2026-07-12 適用済み、commit d1efce2)**: セクションマーカー ID は上記サンプルの位置ベース `sec-{i}` ではなく**安定キー方式 `sec-o{元index}` / `sec-a{追加順}`** が正(削除の編集跨ぎ保証、スペック §6 の意図)。beat/bar/silence の ID はグリッド編集・しきい値変更で振り直されるため、UI はその際に該当 deletedMarkerIds を除去する(計画③の責務、モジュール docstring に契約明記済み)。回帰テスト4件追加(50/50)。

---

### Task 6: ターゲット表・ファイル命名・エクスポータ共通部品 (naming / helpers)

**Files:**
- Create: `app/src/shared/naming.ts`
- Create: `app/src/shared/exporters/helpers.ts`
- Test: `app/src/shared/__tests__/naming.test.ts`

**Interfaces:**
- Consumes: `types.Marker/MarkerType/ExportContext`
- Produces:
  - `naming.ts`:
    - `TargetKey = "json"|"csv"|"midi"|"aejsx"|"premiere"|"resolve"|"blender"|"wavcues"|"reaper"|"nuendo"|"audacity"`
    - `TARGETS: Record<TargetKey, { label: string; abbr: string; ext: string }>` — スペック §8 の略称テーブル: json/csv/midi=`markers`(ext: json/csv/mid)、aejsx=`AE`/jsx、premiere=`PPro`/xml、resolve=`Resolve`/edl、blender=`Blender`/py、wavcues=`cues`/wav、reaper=`REAPER`/csv、nuendo=`Nuendo`/csv、audacity=`Audacity`/txt
    - `buildFileName(baseName: string, sourceLabel: string | null, target: TargetKey): string` — `<base>[_<source>]_<abbr>.<ext>`。ファイル名に使えない文字(`\/:*?"<>|` と空白)は `-` に置換
  - `helpers.ts`:
    - `selectMarkers(markers: Marker[], include: MarkerType[]): Marker[]`
    - `escapeXml(s: string): string`(`& < > " '`)
    - `escapeJsString(s: string): string` — ES3 文字列リテラル用。`\\ ' " \n \r \t` をエスケープし、非 ASCII は `\uXXXX` に変換(AE の ExtendScript でエンコーディング事故を防ぐ)
    - `csvField(s: string): string` — `, " \n` を含む場合は `"..."` で囲み `"` を二重化
    - `padLeft(n: number, width: number): string`

- [ ] **Step 1: 失敗するテストを書く**

`app/src/shared/__tests__/naming.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildFileName, TARGETS } from "../naming.js";
import { csvField, escapeJsString, escapeXml, selectMarkers } from "../exporters/helpers.js";
import type { Marker } from "../types.js";

describe("TARGETS / buildFileName", () => {
  it("略称テーブルがスペック§8と一致", () => {
    expect(TARGETS.aejsx).toEqual({ label: "After Effects", abbr: "AE", ext: "jsx" });
    expect(TARGETS.premiere.abbr).toBe("PPro");
    expect(TARGETS.resolve.abbr).toBe("Resolve");
    expect(TARGETS.midi).toEqual({ label: "MIDI", abbr: "markers", ext: "mid" });
    expect(TARGETS.wavcues.abbr).toBe("cues");
    expect(TARGETS.reaper.abbr).toBe("REAPER");
  });

  it("単一ソース: <base>_<abbr>.<ext>", () => {
    expect(buildFileName("track", null, "aejsx")).toBe("track_AE.jsx");
    expect(buildFileName("track", null, "json")).toBe("track_markers.json");
  });

  it("マルチソース: <base>_<source>_<abbr>.<ext>", () => {
    expect(buildFileName("MV_final", "Vo", "resolve")).toBe("MV_final_Vo_Resolve.edl");
  });

  it("危険文字はハイフンに置換", () => {
    expect(buildFileName("a/b:c", "L R", "csv")).toBe("a-b-c_L-R_markers.csv");
  });
});

describe("helpers", () => {
  it("selectMarkersは種別で選別", () => {
    const m = (type: Marker["type"]): Marker => ({
      id: type, sourceId: "s", timeSec: 0, type, label: "", color: "#000", source: "auto",
    });
    const got = selectMarkers([m("beat"), m("bar"), m("hit")], ["bar", "hit"]);
    expect(got.map((x) => x.type)).toEqual(["bar", "hit"]);
  });

  it("escapeXml", () => {
    expect(escapeXml(`a<b>&"c"'d'`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;&apos;d&apos;");
  });

  it("escapeJsStringはES3安全+非ASCIIを\\uXXXX化", () => {
    expect(escapeJsString(`a'b"c\\d`)).toBe(`a\\'b\\"c\\\\d`);
    expect(escapeJsString("改行\nタブ\t")).toBe("\\u6539\\u884c\\n\\u30bf\\u30d6\\t");
  });

  it("csvField", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('with "quote", comma')).toBe('"with ""quote"", comma"');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/__tests__/naming.test.ts`
Expected: FAIL — `Cannot find module '../naming.js'`

- [ ] **Step 3: 実装**

`app/src/shared/naming.ts`:

```ts
/** 書き出しターゲット表と出力ファイル命名(スペック §8)。
 *  略称の決め方: 通称で通じる最短形。ただし他ツールと紛らわしいものはフル名寄り
 *  (3dsMax を Max としない、Premiere は PPro)。Phase 2 でカスタマイズ可能にする。 */
export type TargetKey =
  | "json" | "csv" | "midi"
  | "aejsx" | "premiere" | "resolve" | "blender"
  | "wavcues" | "reaper" | "nuendo" | "audacity";

export const TARGETS: Record<TargetKey, { label: string; abbr: string; ext: string }> = {
  json: { label: "JSON (正規形式)", abbr: "markers", ext: "json" },
  csv: { label: "CSV", abbr: "markers", ext: "csv" },
  midi: { label: "MIDI", abbr: "markers", ext: "mid" },
  aejsx: { label: "After Effects", abbr: "AE", ext: "jsx" },
  premiere: { label: "Premiere Pro", abbr: "PPro", ext: "xml" },
  resolve: { label: "DaVinci Resolve", abbr: "Resolve", ext: "edl" },
  blender: { label: "Blender", abbr: "Blender", ext: "py" },
  wavcues: { label: "WAV (キュー埋め込み)", abbr: "cues", ext: "wav" },
  reaper: { label: "REAPER", abbr: "REAPER", ext: "csv" },
  nuendo: { label: "Nuendo / Cubase", abbr: "Nuendo", ext: "csv" },
  audacity: { label: "Audacity", abbr: "Audacity", ext: "txt" },
};

function sanitize(part: string): string {
  return part.replace(/[\\/:*?"<>|\s]+/g, "-");
}

export function buildFileName(
  baseName: string, sourceLabel: string | null, target: TargetKey,
): string {
  const t = TARGETS[target];
  const src = sourceLabel ? `_${sanitize(sourceLabel)}` : "";
  return `${sanitize(baseName)}${src}_${t.abbr}.${t.ext}`;
}
```

`app/src/shared/exporters/helpers.ts`:

```ts
/** エクスポータ共通部品。すべて純関数。 */
import type { Marker, MarkerType } from "../types.js";

export function selectMarkers(markers: Marker[], include: MarkerType[]): Marker[] {
  const set = new Set(include);
  return markers.filter((m) => set.has(m.type));
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** ExtendScript(ES3)の '...' / "..." リテラルに安全に埋め込める形へ。
 *  非ASCIIは \uXXXX にする(.jsx ファイルのエンコーディング解釈差を回避)。 */
export function escapeJsString(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === "'") out += "\\'";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code > 0x7e) {
      if (code > 0xffff) { // サロゲートペア
        const h = Math.floor((code - 0x10000) / 0x400) + 0xd800;
        const l = ((code - 0x10000) % 0x400) + 0xdc00;
        out += `\\u${h.toString(16).padStart(4, "0")}\\u${l.toString(16).padStart(4, "0")}`;
      } else {
        out += `\\u${code.toString(16).padStart(4, "0")}`;
      }
    } else out += ch;
  }
  return out;
}

export function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function padLeft(n: number, width: number): string {
  return String(n).padStart(width, "0");
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/__tests__/naming.test.ts && npx tsc --noEmit`
Expected: 8 passed、型エラーなし

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/naming.ts app/src/shared/exporters/helpers.ts app/src/shared/__tests__/naming.test.ts
git commit -m "feat(app): ターゲット表・ファイル命名・エクスポータ共通部品"
```

---

### Task 7: 正規 JSON と汎用 CSV エクスポータ

**Files:**
- Create: `app/src/shared/exporters/json.ts`
- Create: `app/src/shared/exporters/csv.ts`
- Test: `app/src/shared/__tests__/exporters-json-csv.test.ts`

**Interfaces:**
- Consumes: `helpers.selectMarkers/csvField`, `timebase.*`, `types.Marker/ExportContext`
- Produces(全エクスポータ共通のシグネチャ規約もここで確立):
  - **エクスポータ規約**: `export function exportXxx(markers: Marker[], ctx: ExportContext): string`(wavCues のみ bytes 入出力で別シグネチャ)。関数内で `selectMarkers(markers, ctx.include)` を最初に行う
  - `exportJson(markers, ctx): string` — 正規 JSON。トップレベル: `format:"beatmarks-markers"`, `version:1`, `generatedBy:"BeatMarks 0.1.0"`, `baseName`, `sourceLabel`, `fps:{num,den,label}`, `rounding`, `durationSec`, `bpm`(=ctx.bpmLabel), `key`(=ctx.keyLabel), `markers[]`。各マーカー: `id,type,timeSec,frame,timecode,label,color,source` + 任意 `durationSec,frameOut,strength,band,barNumber`(`frameOut` はリージョン終端のフレーム)。2 スペースインデント
  - `exportCsv(markers, ctx): string` — ヘッダ `time_sec,frame,timecode,type,label,color,strength,source`(スペック §8)。strength は空欄可。行末 `\n`、最終行にも改行

- [ ] **Step 1: 失敗するテストを書く**

`app/src/shared/__tests__/exporters-json-csv.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { exportCsv } from "../exporters/csv.js";
import { exportJson } from "../exporters/json.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!,
    rounding: "nearest",
    include: ["section", "bar", "beat", "hit", "silence", "custom"],
    baseName: "track",
    sourceLabel: null,
    audioFileName: "track.wav",
    audioDurationSec: 10,
    bpmLabel: "120.00",
    keyLabel: "C major (8B)",
    beatsPerBar: 4,
    tempoMap: [{ timeSec: 0, bpm: 120 }],
    envelopes: null,
    ...over,
  };
}

const MARKERS: Marker[] = [
  { id: "sec-0", sourceId: "s", timeSec: 0, type: "section", label: "A", color: "#5b7fd4",
    source: "auto", meta: { durationSec: 4.25 } },
  { id: "bar-1", sourceId: "s", timeSec: 0.25, type: "bar", label: "小節1", color: "#e8ebf0",
    source: "auto", meta: { barNumber: 1 } },
  { id: "hit-low-0", sourceId: "s", timeSec: 1.5, type: "hit", label: "low", color: "#ff7847",
    source: "auto", meta: { strength: 0.92, band: "low" } },
  { id: "custom-1", sourceId: "s", timeSec: 2, type: "custom", label: 'say "hi", ok',
    color: "#ffd166", source: "user" },
];

describe("exportJson", () => {
  it("正規JSONの形とフレーム/タイムコード併記", () => {
    const parsed = JSON.parse(exportJson(MARKERS, ctx()));
    expect(parsed.format).toBe("beatmarks-markers");
    expect(parsed.version).toBe(1);
    expect(parsed.fps).toEqual({ num: 30, den: 1, label: "30" });
    expect(parsed.markers).toHaveLength(4);
    const bar = parsed.markers[1];
    expect(bar).toMatchObject({
      id: "bar-1", type: "bar", timeSec: 0.25, frame: 8, timecode: "00:00:00:08",
      barNumber: 1,
    });
    const sec = parsed.markers[0];
    expect(sec.durationSec).toBeCloseTo(4.25);
    expect(sec.frameOut).toBe(128); // round(4.25*30)
    expect(parsed.markers[2].strength).toBeCloseTo(0.92);
  });

  it("includeで種別を絞れる", () => {
    const parsed = JSON.parse(exportJson(MARKERS, ctx({ include: ["hit"] })));
    expect(parsed.markers).toHaveLength(1);
    expect(parsed.markers[0].type).toBe("hit");
  });

  it("29.97ではフレームが分数計算", () => {
    const parsed = JSON.parse(exportJson(MARKERS, ctx({ fps: FPS_PRESETS["29.97"]! })));
    expect(parsed.markers[1].frame).toBe(Math.round((0.25 * 30000) / 1001)); // 7
    expect(parsed.fps.label).toBe("29.97");
  });
});

describe("exportCsv", () => {
  it("ヘッダ・エスケープ・改行", () => {
    const text = exportCsv(MARKERS, ctx());
    const lines = text.split("\n");
    expect(lines[0]).toBe("time_sec,frame,timecode,type,label,color,strength,source");
    expect(lines[1]).toBe("0.000,0,00:00:00:00,section,A,#5b7fd4,,auto");
    expect(lines[2]).toBe("0.250,8,00:00:00:08,bar,小節1,#e8ebf0,,auto");
    expect(lines[3]).toBe("1.500,45,00:00:01:15,hit,low,#ff7847,0.92,auto");
    expect(lines[4]).toBe('2.000,60,00:00:02:00,custom,"say ""hi"", ok",#ffd166,,user');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("floor丸めが効く", () => {
    const m: Marker[] = [{ id: "b", sourceId: "s", timeSec: 0.9999, type: "beat",
      label: "拍", color: "#8b94a3", source: "auto" }];
    const text = exportCsv(m, ctx({ rounding: "floor", include: ["beat"] }));
    expect(text.split("\n")[1]).toContain(",29,"); // floor(29.997)
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/__tests__/exporters-json-csv.test.ts`
Expected: FAIL — `Cannot find module '../exporters/csv.js'`

- [ ] **Step 3: 実装**

`app/src/shared/exporters/json.ts`:

```ts
/** 正規 JSON エクスポータ。全データ+秒/フレーム/タイムコード併記(スペック §8)。
 *  他ツール連携のリファレンス形式なのでキー順・形を安定させる。 */
import { formatTimecode, fpsLabel, timeToFrame } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";
import { selectMarkers } from "./helpers.js";

export const GENERATED_BY = "BeatMarks 0.1.0";

export function exportJson(markers: Marker[], ctx: ExportContext): string {
  const sel = selectMarkers(markers, ctx.include);
  const items = sel.map((m) => {
    const frame = timeToFrame(m.timeSec, ctx.fps, ctx.rounding);
    const item: Record<string, unknown> = {
      id: m.id,
      type: m.type,
      timeSec: m.timeSec,
      frame,
      timecode: formatTimecode(frame, ctx.fps),
      label: m.label,
      color: m.color,
      source: m.source,
    };
    if (m.meta?.durationSec !== undefined) {
      item["durationSec"] = m.meta.durationSec;
      item["frameOut"] = timeToFrame(m.timeSec + m.meta.durationSec, ctx.fps, ctx.rounding);
    }
    if (m.meta?.strength !== undefined) item["strength"] = m.meta.strength;
    if (m.meta?.band !== undefined) item["band"] = m.meta.band;
    if (m.meta?.barNumber !== undefined) item["barNumber"] = m.meta.barNumber;
    return item;
  });

  return JSON.stringify(
    {
      format: "beatmarks-markers",
      version: 1,
      generatedBy: GENERATED_BY,
      baseName: ctx.baseName,
      sourceLabel: ctx.sourceLabel,
      fps: { num: ctx.fps.num, den: ctx.fps.den, label: fpsLabel(ctx.fps) },
      rounding: ctx.rounding,
      durationSec: ctx.audioDurationSec,
      bpm: ctx.bpmLabel,
      key: ctx.keyLabel,
      markers: items,
    },
    null,
    2,
  );
}
```

`app/src/shared/exporters/csv.ts`:

```ts
/** 汎用 CSV。列構成はスペック §8: time_sec, frame, timecode, type, label, color, strength, source */
import { formatSeconds, formatTimecode, timeToFrame } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";
import { csvField, selectMarkers } from "./helpers.js";

export function exportCsv(markers: Marker[], ctx: ExportContext): string {
  const rows = ["time_sec,frame,timecode,type,label,color,strength,source"];
  for (const m of selectMarkers(markers, ctx.include)) {
    const frame = timeToFrame(m.timeSec, ctx.fps, ctx.rounding);
    const strength =
      m.meta?.strength !== undefined ? String(Math.round(m.meta.strength * 100) / 100) : "";
    rows.push(
      [
        formatSeconds(m.timeSec),
        String(frame),
        formatTimecode(frame, ctx.fps),
        m.type,
        csvField(m.label),
        m.color,
        strength,
        m.source,
      ].join(","),
    );
  }
  return rows.join("\n") + "\n";
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/__tests__/exporters-json-csv.test.ts && npx tsc --noEmit`
Expected: 5 passed、型エラーなし

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/exporters/json.ts app/src/shared/exporters/csv.ts app/src/shared/__tests__/exporters-json-csv.test.ts
git commit -m "feat(app): 正規JSON・汎用CSVエクスポータ"
```

> **レビュー後の追補(2026-07-12 適用済み、commit b5bd190)**: スペック §8 の正規JSON定義(テンポマップ+エンベロープ含む)に合わせ、トップレベルに `tempoMap: ctx.tempoMap` と `envelopes: ctx.envelopes`(null可)を追加。実装はこの追補込みが正。

---

### Task 8: MIDI エクスポータ (SMF format 1)

**Files:**
- Create: `app/src/shared/exporters/midi.ts`
- Test: `app/src/shared/__tests__/exporters-midi.test.ts`

**Interfaces:**
- Consumes: `types.Marker/ExportContext/TempoPoint`, `helpers.selectMarkers`
- Produces:
  - `TPQ = 480`(ticks per quarter)
  - `secondsToTicks(timeSec: number, tempoMap: TempoPoint[], tpq?: number): number` — テンポマップの区分積分で秒→tick(テスト・逆変換検証用に export)
  - `exportMidi(markers: Marker[], ctx: ExportContext): Uint8Array` — SMF format 1、4 トラック構成(スペック §8):
    - Track0 "Tempo": 各 `ctx.tempoMap` 点に set_tempo(FF 51 03, μs/四分 = round(60e6/bpm))+ 先頭に拍子(FF 58: nn=ctx.beatsPerBar, dd=2)とトラック名
    - Track1 "Markers": **section / silence / custom** をマーカーメタイベント(FF 06、UTF-8)
    - Track2 "Beats": ch10(index 9)ノート。小節頭 = ノート 48・vel 127、その他の拍 = ノート 36・vel 80、長さ 60 tick。小節頭と重なる拍は小節頭のみ
    - Track3 "Hits": ch10 ノート。low=35 / mid=38 / high=42(GM ドラム準拠)、vel = `round(strength*126)+1`、長さ 60 tick
    - include に応じて各トラックの中身は空になりうるが、トラック数は常に 4(ゴールデン安定化)

- [ ] **Step 1: 失敗するテストを書く**

`app/src/shared/__tests__/exporters-midi.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { exportMidi, secondsToTicks, TPQ } from "../exporters/midi.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker, TempoPoint } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest",
    include: ["section", "bar", "beat", "hit", "silence", "custom"],
    baseName: "track", sourceLabel: null, audioFileName: "track.wav",
    audioDurationSec: 10, bpmLabel: "120.00", keyLabel: "C major (8B)",
    beatsPerBar: 4, tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
    ...over,
  };
}

// ---- テスト用の最小SMFリーダ ----
function readVlq(b: Uint8Array, pos: number): [number, number] {
  let v = 0;
  for (;;) {
    const byte = b[pos++]!;
    v = (v << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return [v, pos];
  }
}

interface Ev { tick: number; kind: string; data: number[]; text?: string }

function parseSmf(bytes: Uint8Array): { format: number; ntrks: number; tpq: number; tracks: Ev[][] } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("MThd");
  const format = dv.getUint16(8);
  const ntrks = dv.getUint16(10);
  const tpq = dv.getUint16(12);
  const tracks: Ev[][] = [];
  let pos = 14;
  for (let t = 0; t < ntrks; t++) {
    expect(String.fromCharCode(...bytes.slice(pos, pos + 4))).toBe("MTrk");
    const len = dv.getUint32(pos + 4);
    let p = pos + 8;
    const end = p + len;
    const evs: Ev[] = [];
    let tick = 0;
    let running = 0;
    while (p < end) {
      const [delta, p2] = readVlq(bytes, p);
      p = p2;
      tick += delta;
      let status = bytes[p]!;
      if (status < 0x80) status = running; else { p++; running = status; }
      if (status === 0xff) {
        const meta = bytes[p++]!;
        const [len2, p3] = readVlq(bytes, p);
        p = p3;
        const data = [...bytes.slice(p, p + len2)];
        p += len2;
        const ev: Ev = { tick, kind: `meta${meta.toString(16)}`, data };
        if (meta === 0x06 || meta === 0x03) {
          ev.text = new TextDecoder().decode(new Uint8Array(data));
        }
        evs.push(ev);
      } else {
        const type = status & 0xf0;
        const n = type === 0xc0 || type === 0xd0 ? 1 : 2;
        evs.push({ tick, kind: `st${type.toString(16)}`, data: [...bytes.slice(p, p + n)] });
        p += n;
      }
    }
    tracks.push(evs);
    pos = end;
  }
  return { format, ntrks, tpq, tracks };
}

describe("secondsToTicks", () => {
  it("固定テンポ: t*bpm/60*TPQ", () => {
    const map: TempoPoint[] = [{ timeSec: 0, bpm: 120 }];
    expect(secondsToTicks(0, map)).toBe(0);
    expect(secondsToTicks(1, map)).toBe(960);
    expect(secondsToTicks(2.5, map)).toBe(2400);
  });

  it("可変テンポ: 区分積分", () => {
    const map: TempoPoint[] = [{ timeSec: 0, bpm: 120 }, { timeSec: 10, bpm: 150 }];
    expect(secondsToTicks(10, map)).toBe(9600);              // 120bpmで10秒
    expect(secondsToTicks(12, map)).toBe(9600 + 2400);       // +150bpmで2秒 = 2.5拍/s*2*480
  });
});

describe("exportMidi", () => {
  const markers: Marker[] = [
    { id: "sec-0", sourceId: "s", timeSec: 0, type: "section", label: "Aメロ",
      color: "#5b7fd4", source: "auto", meta: { durationSec: 4 } },
    { id: "bar-1", sourceId: "s", timeSec: 0.5, type: "bar", label: "小節1",
      color: "#e8ebf0", source: "auto", meta: { barNumber: 1 } },
    { id: "beat-1", sourceId: "s", timeSec: 0.5, type: "beat", label: "拍",
      color: "#8b94a3", source: "auto" }, // 小節頭と同時刻 → ノートは1つだけ
    { id: "beat-2", sourceId: "s", timeSec: 1.0, type: "beat", label: "拍",
      color: "#8b94a3", source: "auto" },
    { id: "hit-low-0", sourceId: "s", timeSec: 2.0, type: "hit", label: "low",
      color: "#ff7847", source: "auto", meta: { strength: 1.0, band: "low" } },
  ];

  it("ヘッダ: format1・4トラック・TPQ", () => {
    const smf = parseSmf(exportMidi(markers, ctx()));
    expect(smf.format).toBe(1);
    expect(smf.ntrks).toBe(4);
    expect(smf.tpq).toBe(TPQ);
  });

  it("Track0: 拍子とテンポ(120bpm=500000μs)", () => {
    const smf = parseSmf(exportMidi(markers, ctx()));
    const tempoEvs = smf.tracks[0]!.filter((e) => e.kind === "meta51");
    expect(tempoEvs).toHaveLength(1);
    const us = (tempoEvs[0]!.data[0]! << 16) | (tempoEvs[0]!.data[1]! << 8) | tempoEvs[0]!.data[2]!;
    expect(us).toBe(500000);
    const ts = smf.tracks[0]!.find((e) => e.kind === "meta58")!;
    expect(ts.data[0]).toBe(4); // beatsPerBar
    expect(ts.data[1]).toBe(2); // 分母4 = 2^2
  });

  it("Track1: セクションがマーカーメタ(UTF-8)", () => {
    const smf = parseSmf(exportMidi(markers, ctx()));
    const ms = smf.tracks[1]!.filter((e) => e.kind === "meta6");
    expect(ms).toHaveLength(1);
    expect(ms[0]!.text).toBe("Aメロ");
    expect(ms[0]!.tick).toBe(0);
  });

  it("Track2: 小節頭48/拍36、同時刻は小節頭のみ", () => {
    const smf = parseSmf(exportMidi(markers, ctx()));
    const ons = smf.tracks[2]!.filter((e) => e.kind === "st90" && e.data[1]! > 0);
    expect(ons).toHaveLength(2); // bar@0.5, beat@1.0(重複beat@0.5は出ない)
    expect(ons[0]!.data[0]).toBe(48);
    expect(ons[0]!.tick).toBe(480); // 0.5s @120bpm = 1拍 = TPQ(480)tick
    expect(ons[1]!.data[0]).toBe(36);
  });

  it("Track3: ヒットはGMドラムノート・強度→ベロシティ", () => {
    const smf = parseSmf(exportMidi(markers, ctx()));
    const ons = smf.tracks[3]!.filter((e) => e.kind === "st90" && e.data[1]! > 0);
    expect(ons).toHaveLength(1);
    expect(ons[0]!.data[0]).toBe(35);   // low
    expect(ons[0]!.data[1]).toBe(127);  // 1.0*126+1
  });

  it("includeで種別を絞ってもトラック数は4", () => {
    const smf = parseSmf(exportMidi(markers, ctx({ include: ["section"] })));
    expect(smf.ntrks).toBe(4);
    expect(smf.tracks[2]!.filter((e) => e.kind === "st90")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/__tests__/exporters-midi.test.ts`
Expected: FAIL — `Cannot find module '../exporters/midi.js'`

- [ ] **Step 3: 実装**

`app/src/shared/exporters/midi.ts`:

```ts
/** SMF (format 1) エクスポータ。DAW 連携の汎用経路(スペック §8)。
 *  Track0=テンポ/拍子、Track1=マーカーメタ、Track2=拍/小節ノート、Track3=ヒットノート。 */
import type { ExportContext, Marker, TempoPoint } from "../types.js";
import { selectMarkers } from "./helpers.js";

export const TPQ = 480;

const NOTE_BAR = 48;
const NOTE_BEAT = 36;
const NOTE_HIT: Record<string, number> = { low: 35, mid: 38, high: 42 }; // GM kick/snare/hat
const NOTE_LEN_TICKS = 60;
const DRUM_CH = 9; // 0起点(=MIDI ch10)

export function secondsToTicks(
  timeSec: number, tempoMap: TempoPoint[], tpq: number = TPQ,
): number {
  if (tempoMap.length === 0) return Math.round(timeSec * 2 * tpq); // 120bpm相当のフォールバック
  let ticks = 0;
  let prevT = 0;
  let prevBpm = tempoMap[0]!.bpm;
  for (const p of tempoMap) {
    if (p.timeSec >= timeSec) break;
    if (p.timeSec > prevT) {
      ticks += ((p.timeSec - prevT) * prevBpm / 60) * tpq;
      prevT = p.timeSec;
    }
    prevBpm = p.bpm;
  }
  ticks += ((timeSec - prevT) * prevBpm / 60) * tpq;
  return Math.round(ticks);
}

// ---- バイト列組み立て ----
class Bytes {
  private buf: number[] = [];
  u8(...v: number[]) { this.buf.push(...v.map((x) => x & 0xff)); }
  u16(v: number) { this.u8(v >> 8, v); }
  u32(v: number) { this.u8(v >>> 24, v >>> 16, v >>> 8, v); }
  ascii(s: string) { for (const c of s) this.u8(c.charCodeAt(0)); }
  bytes(b: Uint8Array | number[]) { for (const x of b) this.u8(x); }
  vlq(v: number) {
    const stack = [v & 0x7f];
    let rest = Math.floor(v / 128);
    while (rest > 0) { stack.push((rest & 0x7f) | 0x80); rest = Math.floor(rest / 128); }
    stack.reverse();
    this.u8(...stack);
  }
  out(): Uint8Array { return new Uint8Array(this.buf); }
}

interface AbsEvent { tick: number; order: number; bytes: number[] }

function metaEvent(type: number, data: number[] | Uint8Array): number[] {
  const arr = [...data];
  const vlq: number[] = [];
  let v = arr.length;
  const stack = [v & 0x7f];
  v = Math.floor(v / 128);
  while (v > 0) { stack.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
  stack.reverse();
  return [0xff, type, ...stack, ...arr];
}

function trackChunk(events: AbsEvent[]): Uint8Array {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body = new Bytes();
  let prev = 0;
  for (const e of events) {
    body.vlq(e.tick - prev);
    prev = e.tick;
    body.u8(...e.bytes);
  }
  body.vlq(0);
  body.u8(...metaEvent(0x2f, [])); // End of Track
  const data = body.out();
  const chunk = new Bytes();
  chunk.ascii("MTrk");
  chunk.u32(data.length);
  chunk.bytes(data);
  return chunk.out();
}

function noteOnOff(tick: number, note: number, vel: number, ch: number): AbsEvent[] {
  return [
    { tick, order: 1, bytes: [0x90 | ch, note, vel] },
    { tick: tick + NOTE_LEN_TICKS, order: 0, bytes: [0x80 | ch, note, 0] },
  ];
}

const enc = new TextEncoder();

export function exportMidi(markers: Marker[], ctx: ExportContext): Uint8Array {
  const sel = selectMarkers(markers, ctx.include);
  const toTick = (t: number) => secondsToTicks(t, ctx.tempoMap);

  // Track 0: テンポ・拍子
  const t0: AbsEvent[] = [
    { tick: 0, order: 0, bytes: metaEvent(0x03, [...enc.encode("BeatMarks Tempo")]) },
    { tick: 0, order: 1, bytes: metaEvent(0x58, [ctx.beatsPerBar & 0xff, 2, 24, 8]) },
  ];
  for (const p of ctx.tempoMap) {
    const us = Math.round(60_000_000 / p.bpm);
    t0.push({
      tick: toTick(p.timeSec), order: 2,
      bytes: metaEvent(0x51, [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]),
    });
  }

  // Track 1: マーカーメタ(section / silence / custom)
  const t1: AbsEvent[] = [
    { tick: 0, order: 0, bytes: metaEvent(0x03, [...enc.encode("BeatMarks Markers")]) },
  ];
  for (const m of sel) {
    if (m.type !== "section" && m.type !== "silence" && m.type !== "custom") continue;
    t1.push({ tick: toTick(m.timeSec), order: 1, bytes: metaEvent(0x06, [...enc.encode(m.label)]) });
  }

  // Track 2: 拍/小節ノート(同tickの拍は小節頭を優先)
  const t2: AbsEvent[] = [
    { tick: 0, order: 0, bytes: metaEvent(0x03, [...enc.encode("BeatMarks Beats")]) },
  ];
  const barTicks = new Set<number>();
  for (const m of sel) {
    if (m.type === "bar") barTicks.add(toTick(m.timeSec));
  }
  for (const m of sel) {
    if (m.type === "bar") {
      t2.push(...noteOnOff(toTick(m.timeSec), NOTE_BAR, 127, DRUM_CH));
    } else if (m.type === "beat") {
      const tick = toTick(m.timeSec);
      if (!barTicks.has(tick)) t2.push(...noteOnOff(tick, NOTE_BEAT, 80, DRUM_CH));
    }
  }

  // Track 3: ヒットノート
  const t3: AbsEvent[] = [
    { tick: 0, order: 0, bytes: metaEvent(0x03, [...enc.encode("BeatMarks Hits")]) },
  ];
  for (const m of sel) {
    if (m.type !== "hit") continue;
    const note = NOTE_HIT[m.meta?.band ?? "low"] ?? NOTE_HIT["low"]!;
    const vel = Math.min(127, Math.round((m.meta?.strength ?? 0.5) * 126) + 1);
    t3.push(...noteOnOff(toTick(m.timeSec), note, vel, DRUM_CH));
  }

  const tracks = [t0, t1, t2, t3].map(trackChunk);
  const out = new Bytes();
  out.ascii("MThd");
  out.u32(6);
  out.u16(1);              // format 1
  out.u16(tracks.length);  // 常に4
  out.u16(TPQ);
  for (const t of tracks) out.bytes(t);
  return out.out();
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/__tests__/exporters-midi.test.ts && npx tsc --noEmit`
Expected: 8 passed、型エラーなし

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/exporters/midi.ts app/src/shared/__tests__/exporters-midi.test.ts
git commit -m "feat(app): MIDIエクスポータ(SMF format1・テンポマップ・GMドラムノート)"
```

---

### Task 9: After Effects .jsx エクスポータ

**Files:**
- Create: `app/src/shared/exporters/aejsx.ts`
- Test: `app/src/shared/__tests__/exporters-aejsx.test.ts`

**Interfaces:**
- Consumes: `helpers.selectMarkers/escapeJsString`, `envelope.resampleEnvelopeToFps`, `timebase.*`
- Produces:
  - `exportAeJsx(markers: Marker[], ctx: ExportContext): string` — 実行すると次を行う **ES3 (ExtendScript)** スクリプトを生成(スペック §8):
    - 新規コンポ作成(名前 `<baseName>_BeatMarks`、1920x1080、fps=指定、尺=曲長)
    - 音声 `ctx.audioFileName` の読み込みを試行(見つからなければ `File.openDialog` にフォールバック、それでも無ければマーカーのみ)
    - スクリプト先頭の `var USE_LAYER_MARKERS = false;` を true にするとコンポマーカーではなく音声レイヤーのマーカーに打つ
    - マーカー: `MarkerValue(label)`、セクション/静寂INは `duration` 付き、`label`(AE のラベル色 1-16)は種別ごとの固定マップ。**同一フレームに複数マーカーが落ちる場合は種別優先度(section>bar>beat>hit>silence>custom)の高い 1 つだけ**打つ(AE は同時刻マーカーを上書きするため)
    - `ctx.envelopes` が非 null なら `BM_Envelopes` ヌルを作り、total/low/mid/high の 4 つの `ADBE Slider Control`(matchName 使用・ロケール非依存)へ `setValuesAtTimes` でフレームごとの値(0-100 スケール)を焼き込み
    - 全体を `app.beginUndoGroup`/`endUndoGroup` と即時関数で包む。ES3 制約: `var` のみ、文字列連結のみ、非 ASCII は `\uXXXX`

- [ ] **Step 1: 失敗するテストを書く**

`app/src/shared/__tests__/exporters-aejsx.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { exportAeJsx } from "../exporters/aejsx.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest",
    include: ["section", "bar", "beat", "hit", "silence", "custom"],
    baseName: "track", sourceLabel: null, audioFileName: "track.wav",
    audioDurationSec: 10, bpmLabel: "120.00", keyLabel: "C major (8B)",
    beatsPerBar: 4, tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
    ...over,
  };
}

const MARKERS: Marker[] = [
  { id: "sec-0", sourceId: "s", timeSec: 0, type: "section", label: "サビ ★",
    color: "#e4547c", source: "auto", meta: { durationSec: 4.25 } },
  { id: "bar-1", sourceId: "s", timeSec: 0.25, type: "bar", label: "小節1",
    color: "#e8ebf0", source: "auto", meta: { barNumber: 1 } },
  { id: "beat-0", sourceId: "s", timeSec: 0.25, type: "beat", label: "拍",
    color: "#8b94a3", source: "auto" }, // barと同フレーム → 出力されない
  { id: "custom-1", sourceId: "s", timeSec: 2, type: "custom", label: "It's \"GO\"",
    color: "#ffd166", source: "user" },
];

describe("exportAeJsx", () => {
  it("ES3構文として妥当(node --checkが通る)", () => {
    const code = exportAeJsx(MARKERS, ctx());
    const dir = mkdtempSync(join(tmpdir(), "bmjsx-"));
    // Node 22 の --check は .js/.mjs/.cjs 以外の拡張子を拒否するため .js で検査する
    const file = join(dir, "out.js");
    writeFileSync(file, code, "utf-8");
    expect(() => execFileSync(process.execPath, ["--check", file])).not.toThrow();
  });

  it("ES3禁止構文を含まない", () => {
    const code = exportAeJsx(MARKERS, ctx());
    expect(code).not.toMatch(/\bconst\b|\blet\b|=>|`/);
    expect(code).not.toMatch(/JSON\./);
  });

  it("コンポ作成・fps・尺・アンドゥグループ", () => {
    const code = exportAeJsx(MARKERS, ctx());
    expect(code).toContain("app.project.items.addComp");
    expect(code).toContain("1920, 1080, 1.0");
    expect(code).toContain("app.beginUndoGroup");
    expect(code).toContain("app.endUndoGroup");
    expect(code).toContain("var FPS = 30;");
    expect(code).toContain("var DURATION = 10;");
  });

  it("29.97は分数の厳密値が埋め込まれる", () => {
    const code = exportAeJsx(MARKERS, ctx({ fps: FPS_PRESETS["29.97"]! }));
    expect(code).toContain("var FPS = 30000 / 1001;");
  });

  it("マーカーデータ: 非ASCIIは\\uXXXX、同一フレームは1個に間引き", () => {
    const code = exportAeJsx(MARKERS, ctx());
    expect(code).toContain("\\u30b5\\u30d3"); // 「サビ」
    expect(code).not.toContain("サビ");        // 生の非ASCIIを含まない
    // barとbeatが同フレーム(0.25s→frame8)→ marker行は sec,bar,custom の3つ
    const matches = code.match(/BM_MARKERS\.push/g) ?? [];
    expect(matches).toHaveLength(3);
    expect(code).toContain('\\"GO\\"'); // 引用符エスケープ
  });

  it("durationがマーカーデータ行に入る", () => {
    const code = exportAeJsx(MARKERS, ctx());
    expect(code).toMatch(/, 4\.25,/); // sec-0 のデータ行 [0, '...', 4.25, 9]
    expect(code).toContain("mv.duration = row[2];");
  });

  it("envelopes付きだとスライダー焼き込みコードが出る", () => {
    const env = {
      sampleRateHz: 100,
      total: Array(1000).fill(0.5) as number[],
      low: Array(1000).fill(0.25) as number[],
      mid: Array(1000).fill(0.25) as number[],
      high: Array(1000).fill(0.25) as number[],
    };
    const code = exportAeJsx(MARKERS, ctx({ envelopes: env }));
    expect(code).toContain("BM_Envelopes");
    expect(code).toContain("ADBE Slider Control");
    expect(code).toContain("setValuesAtTimes");
    // 10秒×30fps → 301点
    expect(code).toContain("var BM_ENV_N = 301;");
    const none = exportAeJsx(MARKERS, ctx({ envelopes: null }));
    expect(none).not.toContain("BM_Envelopes");
  });

  it("USE_LAYER_MARKERSフラグとフォールバック取り込みが含まれる", () => {
    const code = exportAeJsx(MARKERS, ctx());
    expect(code).toContain("var USE_LAYER_MARKERS = false;");
    expect(code).toContain("File.openDialog");
    expect(code).toContain("new ImportOptions");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/__tests__/exporters-aejsx.test.ts`
Expected: FAIL — `Cannot find module '../exporters/aejsx.js'`

- [ ] **Step 3: 実装**

`app/src/shared/exporters/aejsx.ts`:

```ts
/** After Effects 用 ExtendScript (.jsx) 生成(スペック §8)。
 *  生成コードは ES3 のみ(var / 文字列連結 / \uXXXX)。エフェクトやプロパティは
 *  matchName で参照し、日本語版 AE でもそのまま動くようにする。 */
import { resampleEnvelopeToFps } from "../envelope.js";
import { fpsValue, timeToFrame } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";
import { escapeJsString, selectMarkers } from "./helpers.js";

/** AE のマーカー/レイヤーラベル色番号(1-16)への種別マップ */
const TYPE_TO_AE_LABEL: Record<Marker["type"], number> = {
  section: 9,  // 赤系
  bar: 5,      // シアン系
  beat: 14,    // 淡青
  hit: 2,      // 黄
  silence: 8,  // 灰青
  custom: 10,  // 紫
};

const TYPE_PRIORITY: Record<Marker["type"], number> = {
  section: 0, bar: 1, beat: 2, hit: 3, silence: 4, custom: 5,
};

function fpsLiteral(ctx: ExportContext): string {
  return ctx.fps.den === 1 ? String(ctx.fps.num) : `${ctx.fps.num} / ${ctx.fps.den}`;
}

function numLit(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6);
}

export function exportAeJsx(markers: Marker[], ctx: ExportContext): string {
  const sel = selectMarkers(markers, ctx.include)
    .slice()
    .sort((a, b) => a.timeSec - b.timeSec || TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]);

  // 同一フレームに落ちるマーカーは優先度の高い1つだけ(AEは同時刻を上書きするため)
  const seen = new Set<number>();
  const rows: string[] = [];
  for (const m of sel) {
    const frame = timeToFrame(m.timeSec, ctx.fps, ctx.rounding);
    if (seen.has(frame)) continue;
    seen.add(frame);
    const dur = m.meta?.durationSec ?? 0;
    rows.push(
      `BM_MARKERS.push([${numLit(m.timeSec)}, '${escapeJsString(m.label)}', ` +
      `${numLit(dur)}, ${TYPE_TO_AE_LABEL[m.type]}]);`,
    );
  }

  // エンベロープ(0-100スケールでスライダーへ)
  let envDecl = "";
  let envApply = "";
  if (ctx.envelopes) {
    const bands = ["total", "low", "mid", "high"] as const;
    const series = bands.map((b) =>
      resampleEnvelopeToFps(ctx.envelopes![b], ctx.envelopes!.sampleRateHz, ctx.fps, ctx.audioDurationSec)
        .map((v) => Math.round(v * 1000) / 10), // 0-100, 小数1桁
    );
    const n = series[0]!.length;
    envDecl =
      `var BM_ENV_N = ${n};\n` +
      bands.map((b, i) => `var BM_ENV_${b} = [${series[i]!.join(",")}];`).join("\n") + "\n";
    envApply = [
      "  var envLayer = comp.layers.addNull(DURATION);",
      "  envLayer.name = 'BM_Envelopes';",
      "  var envTimes = [];",
      "  for (var ti = 0; ti < BM_ENV_N; ti++) { envTimes.push(ti / FPS); }",
      "  var BM_BANDS = [['total', BM_ENV_total], ['low', BM_ENV_low], ['mid', BM_ENV_mid], ['high', BM_ENV_high]];",
      "  for (var bi = 0; bi < BM_BANDS.length; bi++) {",
      "    var fx = envLayer.property('ADBE Effect Parade').addProperty('ADBE Slider Control');",
      "    fx.name = 'BM_' + BM_BANDS[bi][0];",
      "    fx.property('ADBE Slider Control-0001').setValuesAtTimes(envTimes, BM_BANDS[bi][1]);",
      "  }",
    ].join("\n");
  }

  const compName = escapeJsString(`${ctx.baseName}_BeatMarks`);
  const audioFile = escapeJsString(ctx.audioFileName);
  const info = escapeJsString(`BPM ${ctx.bpmLabel} / KEY ${ctx.keyLabel}`);

  return [
    `// BeatMarks export for After Effects (generated by BeatMarks 0.1.0)`,
    `// fps=${fpsValue(ctx.fps).toFixed(3)} rounding=${ctx.rounding}`,
    `(function () {`,
    `  var USE_LAYER_MARKERS = false; // true: 音声レイヤーのマーカーに打つ`,
    `  var AUDIO_FILE = '${audioFile}'; // 見つからない場合はダイアログで選択`,
    ``,
    `  var FPS = ${fpsLiteral(ctx)};`,
    `  var DURATION = ${numLit(ctx.audioDurationSec)};`,
    ``,
    `  var BM_MARKERS = [];`,
    rows.map((r) => `  ${r}`).join("\n"),
    envDecl ? envDecl.split("\n").map((l) => (l ? `  ${l}` : l)).join("\n") : `  // (envelopes: none)`,
    ``,
    `  app.beginUndoGroup('BeatMarks Import');`,
    `  var comp = app.project.items.addComp('${compName}', 1920, 1080, 1.0, DURATION, FPS);`,
    `  comp.comment = '${info}';`,
    ``,
    `  var audioLayer = null;`,
    `  try {`,
    `    var f = File(AUDIO_FILE);`,
    `    if (!f.exists) { f = File.openDialog('BeatMarks: \\u97f3\\u58f0\\u30d5\\u30a1\\u30a4\\u30eb\\u3092\\u9078\\u629e (' + AUDIO_FILE + ')'); }`,
    `    if (f && f.exists) {`,
    `      var footage = app.project.importFile(new ImportOptions(f));`,
    `      audioLayer = comp.layers.add(footage);`,
    `    }`,
    `  } catch (eImport) {}`,
    ``,
    `  var target = comp.markerProperty;`,
    `  if (USE_LAYER_MARKERS && audioLayer !== null) { target = audioLayer.property('Marker'); }`,
    `  for (var i = 0; i < BM_MARKERS.length; i++) {`,
    `    var row = BM_MARKERS[i];`,
    `    var mv = new MarkerValue(row[1]);`,
    `    if (row[2] > 0) { mv.duration = row[2]; }`,
    `    try { mv.label = row[3]; } catch (eLabel) {} // AE 2019+`,
    `    target.setValueAtTime(row[0], mv);`,
    `  }`,
    envApply ? envApply : `  // (no envelope layer)`,
    `  app.endUndoGroup();`,
    `})();`,
    ``,
  ].join("\n");
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/__tests__/exporters-aejsx.test.ts && npx tsc --noEmit`
Expected: 8 passed、型エラーなし

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/exporters/aejsx.ts app/src/shared/__tests__/exporters-aejsx.test.ts
git commit -m "feat(app): After Effects .jsxエクスポータ(ES3・matchName・エンベロープ焼き込み)"
```

---

### Task 10: Premiere FCP XML エクスポータ

**Files:**
- Create: `app/src/shared/exporters/premiereXml.ts`
- Test: `app/src/shared/__tests__/exporters-premiere.test.ts`

**Interfaces:**
- Consumes: `helpers.selectMarkers/escapeXml`, `timebase.*`
- Produces:
  - `exportPremiereXml(markers: Marker[], ctx: ExportContext): string` — xmeml v4 のマーカー付きシーケンス(スペック §8)。`<rate>` は `timebase = ceil(num/den)`、`ntsc = den===1001 ? "TRUE" : "FALSE"`。各マーカーは `<marker><name>ラベル</name><comment>種別</comment><in>フレーム</in><out>リージョンなら終端フレーム、点なら-1</out></marker>`。シーケンス `<duration>` は曲長のフレーム数

- [ ] **Step 1: 失敗するテストを書く**

`app/src/shared/__tests__/exporters-premiere.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { exportPremiereXml } from "../exporters/premiereXml.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest",
    include: ["section", "bar", "custom"],
    baseName: "track", sourceLabel: null, audioFileName: "track.wav",
    audioDurationSec: 10, bpmLabel: "120.00", keyLabel: "C major (8B)",
    beatsPerBar: 4, tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
    ...over,
  };
}

const MARKERS: Marker[] = [
  { id: "sec-0", sourceId: "s", timeSec: 0, type: "section", label: "A & B <サビ>",
    color: "#e4547c", source: "auto", meta: { durationSec: 4.25 } },
  { id: "bar-1", sourceId: "s", timeSec: 0.25, type: "bar", label: "小節1",
    color: "#e8ebf0", source: "auto", meta: { barNumber: 1 } },
];

describe("exportPremiereXml", () => {
  it("xmeml v4の骨格とシーケンス名", () => {
    const xml = exportPremiereXml(MARKERS, ctx());
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<!DOCTYPE xmeml>");
    expect(xml).toContain('<xmeml version="4">');
    expect(xml).toContain("<name>track_BeatMarks</name>");
    expect(xml).toContain("<duration>300</duration>"); // 10s*30
  });

  it("整数fpsはntsc=FALSE", () => {
    const xml = exportPremiereXml(MARKERS, ctx());
    expect(xml).toContain("<timebase>30</timebase>");
    expect(xml).toContain("<ntsc>FALSE</ntsc>");
  });

  it("29.97はtimebase30/ntsc=TRUE", () => {
    const xml = exportPremiereXml(MARKERS, ctx({ fps: FPS_PRESETS["29.97"]! }));
    expect(xml).toContain("<timebase>30</timebase>");
    expect(xml).toContain("<ntsc>TRUE</ntsc>");
  });

  it("マーカー: エスケープ・in/out・リージョン", () => {
    const xml = exportPremiereXml(MARKERS, ctx());
    expect(xml).toContain("<name>A &amp; B &lt;サビ&gt;</name>");
    expect(xml).toContain("<in>0</in>");
    expect(xml).toContain("<out>128</out>");  // round(4.25*30)
    expect(xml).toContain("<in>8</in>");      // 小節1 @0.25s
    expect(xml).toMatch(/<in>8<\/in>\s*<out>-1<\/out>/); // 点マーカーはout=-1
  });

  it("includeで絞れる", () => {
    const xml = exportPremiereXml(MARKERS, ctx({ include: ["bar"] }));
    expect(xml).not.toContain("A &amp; B");
    expect((xml.match(/<marker>/g) ?? []).length).toBe(1);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/__tests__/exporters-premiere.test.ts`
Expected: FAIL — `Cannot find module '../exporters/premiereXml.js'`

- [ ] **Step 3: 実装**

`app/src/shared/exporters/premiereXml.ts`:

```ts
/** Premiere Pro 向け FCP XML (xmeml v4)。マーカー付きの空シーケンスを生成し、
 *  Premiere の「ファイル > 読み込み」でシーケンスマーカーとして取り込める(スペック §8)。 */
import { timeToFrame } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";
import { escapeXml, selectMarkers } from "./helpers.js";

function rateXml(ctx: ExportContext, indent: string): string {
  const timebase = Math.ceil(ctx.fps.num / ctx.fps.den);
  const ntsc = ctx.fps.den === 1001 ? "TRUE" : "FALSE";
  return [
    `${indent}<rate>`,
    `${indent}  <timebase>${timebase}</timebase>`,
    `${indent}  <ntsc>${ntsc}</ntsc>`,
    `${indent}</rate>`,
  ].join("\n");
}

export function exportPremiereXml(markers: Marker[], ctx: ExportContext): string {
  const sel = selectMarkers(markers, ctx.include);
  const durFrames = timeToFrame(ctx.audioDurationSec, ctx.fps, "floor");

  const markerXml = sel
    .map((m) => {
      const inF = timeToFrame(m.timeSec, ctx.fps, ctx.rounding);
      const outF = m.meta?.durationSec
        ? timeToFrame(m.timeSec + m.meta.durationSec, ctx.fps, ctx.rounding)
        : -1;
      return [
        `    <marker>`,
        `      <name>${escapeXml(m.label)}</name>`,
        `      <comment>${escapeXml(`BeatMarks:${m.type}`)}</comment>`,
        `      <in>${inF}</in>`,
        `      <out>${outF}</out>`,
        `    </marker>`,
      ].join("\n");
    })
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE xmeml>`,
    `<xmeml version="4">`,
    `  <sequence id="beatmarks-sequence-1">`,
    `    <name>${escapeXml(`${ctx.baseName}_BeatMarks`)}</name>`,
    `    <duration>${durFrames}</duration>`,
    rateXml(ctx, "    "),
    `    <timecode>`,
    rateXml(ctx, "      "),
    `      <string>00:00:00:00</string>`,
    `      <frame>0</frame>`,
    `      <displayformat>NDF</displayformat>`,
    `    </timecode>`,
    `    <media>`,
    `      <video>`,
    `        <format>`,
    `          <samplecharacteristics>`,
    rateXml(ctx, "            "),
    `            <width>1920</width>`,
    `            <height>1080</height>`,
    `          </samplecharacteristics>`,
    `        </format>`,
    `      </video>`,
    `    </media>`,
    markerXml,
    `  </sequence>`,
    `</xmeml>`,
    ``,
  ].join("\n");
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/__tests__/exporters-premiere.test.ts && npx tsc --noEmit`
Expected: 5 passed、型エラーなし

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/exporters/premiereXml.ts app/src/shared/__tests__/exporters-premiere.test.ts
git commit -m "feat(app): Premiere FCP XML(xmeml v4)エクスポータ"
```

---

### Task 11: DaVinci Resolve マーカー EDL エクスポータ

**Files:**
- Create: `app/src/shared/exporters/resolveEdl.ts`
- Test: `app/src/shared/__tests__/exporters-resolve.test.ts`

**Interfaces:**
- Consumes: `helpers.selectMarkers/padLeft`, `timebase.formatTimecode/timeToFrame`
- Produces:
  - `exportResolveEdl(markers: Marker[], ctx: ExportContext): string` — Resolve の「タイムライン > 読み込み > Timeline Markers from EDL」互換(スペック §8)。CMX3600 風:
    - ヘッダ `TITLE: <baseName>_BeatMarks` + `FCM: NON-DROP FRAME` + 空行
    - イベント: `NNN  001      V     C        <inTC> <outTC> <inTC> <outTC>` の行 + 続けてコメント行 ` |C:ResolveColor<色名> |M:<ラベル> |D:<durationフレーム(最低1)>` + 空行
    - 色は BeatMarks パレットの hex → Resolve 色名の固定マップ(未知の hex は Blue)。**改行は CRLF**

- [ ] **Step 1: 失敗するテストを書く**

`app/src/shared/__tests__/exporters-resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { exportResolveEdl } from "../exporters/resolveEdl.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest",
    include: ["section", "bar", "hit"],
    baseName: "track", sourceLabel: null, audioFileName: "track.wav",
    audioDurationSec: 10, bpmLabel: "120.00", keyLabel: "C major (8B)",
    beatsPerBar: 4, tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
    ...over,
  };
}

const MARKERS: Marker[] = [
  { id: "sec-0", sourceId: "s", timeSec: 0, type: "section", label: "サビ ★",
    color: "#e4547c", source: "auto", meta: { durationSec: 4.25 } },
  { id: "bar-1", sourceId: "s", timeSec: 0.25, type: "bar", label: "小節1",
    color: "#e8ebf0", source: "auto", meta: { barNumber: 1 } },
  { id: "hit-low-0", sourceId: "s", timeSec: 1.5, type: "hit", label: "low",
    color: "#ff7847", source: "auto", meta: { strength: 0.9, band: "low" } },
];

describe("exportResolveEdl", () => {
  it("ヘッダとCRLF", () => {
    const edl = exportResolveEdl(MARKERS, ctx());
    expect(edl.startsWith("TITLE: track_BeatMarks\r\n")).toBe(true);
    expect(edl).toContain("FCM: NON-DROP FRAME\r\n");
    expect(edl).not.toMatch(/[^\r]\n/); // 生LFなし(すべてCRLF)
  });

  it("イベント行: 連番・TC・コメント行のメタ", () => {
    const edl = exportResolveEdl(MARKERS, ctx());
    expect(edl).toContain("001  001      V     C        00:00:00:00 00:00:04:08 00:00:00:00 00:00:04:08");
    expect(edl).toContain("|C:ResolveColorRose |M:サビ ★ |D:128"); // round(4.25*30)=128
    expect(edl).toContain("002  001      V     C        00:00:00:08 00:00:00:09 00:00:00:08 00:00:00:09");
    expect(edl).toContain("|D:1"); // 点マーカーは1フレーム
  });

  it("色マップ: 未知色はBlue、既知パレットは対応色", () => {
    const edl = exportResolveEdl(MARKERS, ctx());
    expect(edl).toContain("ResolveColorRose");   // #e4547c
    expect(edl).toContain("ResolveColorCream");  // #e8ebf0
    expect(edl).toContain("ResolveColorRed");    // #ff7847
    const unknown: Marker[] = [{ ...MARKERS[1]!, color: "#010203" }];
    expect(exportResolveEdl(unknown, ctx({ include: ["bar"] }))).toContain("ResolveColorBlue");
  });

  it("29.97でもTCはノンドロップのベース30", () => {
    const edl = exportResolveEdl(MARKERS, ctx({ fps: FPS_PRESETS["29.97"]!, include: ["bar"] }));
    expect(edl).toContain("00:00:00:07"); // round(0.25*30000/1001)=7
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/__tests__/exporters-resolve.test.ts`
Expected: FAIL — `Cannot find module '../exporters/resolveEdl.js'`

- [ ] **Step 3: 実装**

`app/src/shared/exporters/resolveEdl.ts`:

```ts
/** DaVinci Resolve のマーカー読み込み(Timeline Markers from EDL)互換の
 *  CMX3600 風 EDL(スペック §8)。1マーカー = イベント行+コメント行。改行は CRLF。 */
import { formatTimecode, timeToFrame } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";
import { padLeft, selectMarkers } from "./helpers.js";

/** BeatMarks パレット hex → Resolve マーカー色名 */
const COLOR_MAP: Record<string, string> = {
  "#5b7fd4": "Blue", "#38a3a5": "Cyan", "#f4a259": "Sand", "#e4547c": "Rose",
  "#8d78d9": "Purple", "#b56fd0": "Lavender", "#6b7686": "Sky", "#4f8f6b": "Mint",
  "#ff7847": "Red", "#ffd166": "Yellow", "#5ad1e6": "Cyan",
  "#8b94a3": "Sky", "#e8ebf0": "Cream",
};

export function exportResolveEdl(markers: Marker[], ctx: ExportContext): string {
  const sel = selectMarkers(markers, ctx.include);
  const lines: string[] = [`TITLE: ${ctx.baseName}_BeatMarks`, `FCM: NON-DROP FRAME`, ``];

  sel.forEach((m, i) => {
    const inF = timeToFrame(m.timeSec, ctx.fps, ctx.rounding);
    const durF = m.meta?.durationSec
      ? Math.max(1, timeToFrame(m.timeSec + m.meta.durationSec, ctx.fps, ctx.rounding) - inF)
      : 1;
    const inTC = formatTimecode(inF, ctx.fps);
    const outTC = formatTimecode(inF + durF, ctx.fps);
    const color = COLOR_MAP[m.color.toLowerCase()] ?? "Blue";
    lines.push(
      `${padLeft(i + 1, 3)}  001      V     C        ${inTC} ${outTC} ${inTC} ${outTC}`,
      ` |C:ResolveColor${color} |M:${m.label} |D:${durF}`,
      ``,
    );
  });

  return lines.join("\r\n");
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/__tests__/exporters-resolve.test.ts && npx tsc --noEmit`
Expected: 4 passed、型エラーなし

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/exporters/resolveEdl.ts app/src/shared/__tests__/exporters-resolve.test.ts
git commit -m "feat(app): Resolve マーカーEDLエクスポータ(色マップ・CRLF)"
```

---

### Task 12: Blender .py / REAPER CSV / Nuendo CSV / Audacity ラベル

**Files:**
- Create: `app/src/shared/exporters/blenderPy.ts`
- Create: `app/src/shared/exporters/reaperCsv.ts`
- Create: `app/src/shared/exporters/nuendoCsv.ts`
- Create: `app/src/shared/exporters/audacityTxt.ts`
- Test: `app/src/shared/__tests__/exporters-small.test.ts`

**Interfaces:**
- Consumes: `helpers.*`, `timebase.*`
- Produces:
  - `exportBlenderPy(markers, ctx): string` — 実行するとシーン fps 設定+タイムラインマーカー生成する Python スクリプト。fps は `scene.render.fps = ceil(num/den)` / `scene.render.fps_base = den===1001 ? 1.001 : 1.0`。`scene.frame_end` を曲長フレームに設定。先頭の `ADD_SOUND = False` を True にすると VSE に音声ストリップを配置(スペック §8)。ラベルは Python 文字列としてエスケープ
  - `exportReaperCsv(markers, ctx): string` — **タブ区切り**、ヘッダ `Name	Start	End	Length	Color	Type`。時間は秒 6 桁固定。リージョン(duration あり)は End/Length、点は End=Start・Length=0。X-Raym スクリプトはインポート時に列マッピングを指定できるため(2026-07 調査)、この安定した列構成を正とする
  - `exportNuendoCsv(markers, ctx): string` — カンマ区切り CSV、ヘッダ `Name,Start,End,Length,Description`。Start/End はタイムコード文字列。**Nuendo が対応する fps(24/25/29.97/30)以外が指定されたら `ExportError` を投げる**(2026-07 調査: Nuendo の CSV インポート対応レートは 24/25/29.97/29.97d/30/30d)
  - `exportAudacityTxt(markers, ctx): string` — Audacity ラベルトラック形式: `開始秒<TAB>終了秒<TAB>ラベル`、秒 6 桁固定
  - `helpers.ts` に追記: `export class ExportError extends Error {}`

- [ ] **Step 1: 失敗するテストを書く**

`app/src/shared/__tests__/exporters-small.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { exportAudacityTxt } from "../exporters/audacityTxt.js";
import { exportBlenderPy } from "../exporters/blenderPy.js";
import { ExportError } from "../exporters/helpers.js";
import { exportNuendoCsv } from "../exporters/nuendoCsv.js";
import { exportReaperCsv } from "../exporters/reaperCsv.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest",
    include: ["section", "bar", "custom"],
    baseName: "track", sourceLabel: null, audioFileName: "track.wav",
    audioDurationSec: 10, bpmLabel: "120.00", keyLabel: "C major (8B)",
    beatsPerBar: 4, tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
    ...over,
  };
}

const MARKERS: Marker[] = [
  { id: "sec-0", sourceId: "s", timeSec: 0, type: "section", label: "サビ 'A'",
    color: "#e4547c", source: "auto", meta: { durationSec: 4.25 } },
  { id: "bar-1", sourceId: "s", timeSec: 0.25, type: "bar", label: "小節1",
    color: "#e8ebf0", source: "auto", meta: { barNumber: 1 } },
];

describe("exportBlenderPy", () => {
  it("fps設定・マーカー生成・frame_end", () => {
    const py = exportBlenderPy(MARKERS, ctx());
    expect(py).toContain("import bpy");
    expect(py).toContain("scene.render.fps = 30");
    expect(py).toContain("scene.render.fps_base = 1.0");
    expect(py).toContain("timeline_markers.new");
    expect(py).toContain("frame=8"); // 小節1 @0.25s*30
    expect(py).toContain("scene.frame_end = 300");
    expect(py).toContain("ADD_SOUND = False");
  });

  it("29.97はfps_base=1.001", () => {
    const py = exportBlenderPy(MARKERS, ctx({ fps: FPS_PRESETS["29.97"]! }));
    expect(py).toContain("scene.render.fps = 30");
    expect(py).toContain("scene.render.fps_base = 1.001");
  });

  it("ラベルはPython文字列リテラルとして正しく埋め込まれる", () => {
    const py = exportBlenderPy(MARKERS, ctx());
    expect(py).toContain(`timeline_markers.new("サビ 'A'", frame=0)`);
    expect(py).toContain(`timeline_markers.new("小節1", frame=8)`);
    const withQuote: Marker[] = [{ ...MARKERS[1]!, label: 'say "hi"' }];
    expect(exportBlenderPy(withQuote, ctx({ include: ["bar"] })))
      .toContain(`timeline_markers.new("say \\"hi\\"", frame=8)`);
  });
});

describe("exportReaperCsv", () => {
  it("タブ区切り・ヘッダ・リージョンと点", () => {
    const text = exportReaperCsv(MARKERS, ctx());
    const lines = text.split("\n");
    expect(lines[0]).toBe("Name\tStart\tEnd\tLength\tColor\tType");
    expect(lines[1]).toBe("サビ 'A'\t0.000000\t4.250000\t4.250000\t#e4547c\tsection");
    expect(lines[2]).toBe("小節1\t0.250000\t0.250000\t0.000000\t#e8ebf0\tbar");
  });
});

describe("exportNuendoCsv", () => {
  it("タイムコード列で出力", () => {
    const text = exportNuendoCsv(MARKERS, ctx());
    const lines = text.split("\n");
    expect(lines[0]).toBe("Name,Start,End,Length,Description");
    expect(lines[1]).toBe('サビ \'A\',00:00:00:00,00:00:04:08,00:00:04:08,BeatMarks:section');
    expect(lines[2]).toBe("小節1,00:00:00:08,00:00:00:08,00:00:00:00,BeatMarks:bar");
  });

  it("非対応fps(60)はExportError", () => {
    expect(() => exportNuendoCsv(MARKERS, ctx({ fps: FPS_PRESETS["60"]! }))).toThrow(ExportError);
    expect(() => exportNuendoCsv(MARKERS, ctx({ fps: FPS_PRESETS["29.97"]! }))).not.toThrow();
  });

  it("カンマを含むラベルはクオート", () => {
    const m: Marker[] = [{ ...MARKERS[1]!, label: "a,b" }];
    expect(exportNuendoCsv(m, ctx({ include: ["bar"] }))).toContain('"a,b",00:00:00:08');
  });
});

describe("exportAudacityTxt", () => {
  it("start TAB end TAB label", () => {
    const text = exportAudacityTxt(MARKERS, ctx());
    const lines = text.split("\n");
    expect(lines[0]).toBe("0.000000\t4.250000\tサビ 'A'");
    expect(lines[1]).toBe("0.250000\t0.250000\t小節1");
    expect(text.endsWith("\n")).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/__tests__/exporters-small.test.ts`
Expected: FAIL — `Cannot find module` 系

- [ ] **Step 3: 実装**

`app/src/shared/exporters/helpers.ts` に追記:

```ts
export class ExportError extends Error {}
```

`app/src/shared/exporters/blenderPy.ts`:

```ts
/** Blender 用スクリプト。テキストエディタで開いて実行すると fps 設定+
 *  タイムラインマーカーを生成する(スペック §8)。 */
import { timeToFrame } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";
import { selectMarkers } from "./helpers.js";

function pyString(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (code < 0x20) out += `\\x${code.toString(16).padStart(2, "0")}`;
    else out += ch; // Python3 ソースは UTF-8 なので非ASCIIはそのままでよい
  }
  return `"${out}"`;
}

export function exportBlenderPy(markers: Marker[], ctx: ExportContext): string {
  const sel = selectMarkers(markers, ctx.include);
  const fpsInt = Math.ceil(ctx.fps.num / ctx.fps.den);
  const fpsBase = ctx.fps.den === 1001 ? "1.001" : "1.0";
  const endFrame = timeToFrame(ctx.audioDurationSec, ctx.fps, "floor");

  const markerLines = sel.map((m) => {
    const frame = timeToFrame(m.timeSec, ctx.fps, ctx.rounding);
    return `scene.timeline_markers.new(${pyString(m.label)}, frame=${frame})`;
  });

  return [
    `# BeatMarks export for Blender (generated by BeatMarks 0.1.0)`,
    `# BPM ${ctx.bpmLabel} / KEY ${ctx.keyLabel}`,
    `import bpy`,
    ``,
    `ADD_SOUND = False  # True にすると VSE に音声ストリップを配置`,
    `AUDIO_FILE = ${pyString(ctx.audioFileName)}`,
    ``,
    `scene = bpy.context.scene`,
    `scene.render.fps = ${fpsInt}`,
    `scene.render.fps_base = ${fpsBase}`,
    `scene.frame_start = 0`,
    `scene.frame_end = ${endFrame}`,
    ``,
    ...markerLines,
    ``,
    `if ADD_SOUND:`,
    `    if not scene.sequence_editor:`,
    `        scene.sequence_editor_create()`,
    `    scene.sequence_editor.sequences.new_sound("BeatMarks Audio", AUDIO_FILE, 1, 0)`,
    ``,
    `print("BeatMarks: %d markers" % ${sel.length})`,
    ``,
  ].join("\n");
}
```

`app/src/shared/exporters/reaperCsv.ts`:

```ts
/** REAPER 用タブ区切り CSV。X-Raym の「Import markers and regions from
 *  tab-delimited CSV file」で読み込む(インポート時に列を指定できるため、
 *  この安定した列構成を正とする。2026-07 調査)。 */
import type { ExportContext, Marker } from "../types.js";
import { selectMarkers } from "./helpers.js";

const sec = (n: number) => n.toFixed(6);

export function exportReaperCsv(markers: Marker[], ctx: ExportContext): string {
  const rows = ["Name\tStart\tEnd\tLength\tColor\tType"];
  for (const m of selectMarkers(markers, ctx.include)) {
    const dur = m.meta?.durationSec ?? 0;
    const name = m.label.replace(/\t/g, " ").replace(/\n/g, " ");
    rows.push(
      `${name}\t${sec(m.timeSec)}\t${sec(m.timeSec + dur)}\t${sec(dur)}\t${m.color}\t${m.type}`,
    );
  }
  return rows.join("\n") + "\n";
}
```

`app/src/shared/exporters/nuendoCsv.ts`:

```ts
/** Nuendo / Cubase のマーカー CSV 読み込み用。Start/End はタイムコード。
 *  Nuendo の CSV インポートは 24 / 25 / 29.97 / 30 fps 系のみ対応
 *  (2026-07 調査、Steinberg 公式ドキュメント)— それ以外は ExportError。 */
import { formatTimecode, timeToFrame } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";
import { csvField, ExportError, selectMarkers } from "./helpers.js";

const SUPPORTED = new Set(["24/1", "25/1", "30000/1001", "30/1"]);

export function exportNuendoCsv(markers: Marker[], ctx: ExportContext): string {
  if (!SUPPORTED.has(`${ctx.fps.num}/${ctx.fps.den}`)) {
    throw new ExportError(
      `Nuendo CSV は 24/25/29.97/30fps のみ対応です(指定: ${ctx.fps.num}/${ctx.fps.den})`,
    );
  }
  const rows = ["Name,Start,End,Length,Description"];
  for (const m of selectMarkers(markers, ctx.include)) {
    const inF = timeToFrame(m.timeSec, ctx.fps, ctx.rounding);
    const dur = m.meta?.durationSec ?? 0;
    const outF = dur > 0 ? timeToFrame(m.timeSec + dur, ctx.fps, ctx.rounding) : inF;
    rows.push([
      csvField(m.label),
      formatTimecode(inF, ctx.fps),
      formatTimecode(outF, ctx.fps),
      formatTimecode(outF - inF, ctx.fps),
      `BeatMarks:${m.type}`,
    ].join(","));
  }
  return rows.join("\n") + "\n";
}
```

`app/src/shared/exporters/audacityTxt.ts`:

```ts
/** Audacity ラベルトラック形式(タブ区切り: start / end / label)。 */
import type { ExportContext, Marker } from "../types.js";
import { selectMarkers } from "./helpers.js";

const sec = (n: number) => n.toFixed(6);

export function exportAudacityTxt(markers: Marker[], ctx: ExportContext): string {
  const rows: string[] = [];
  for (const m of selectMarkers(markers, ctx.include)) {
    const dur = m.meta?.durationSec ?? 0;
    const name = m.label.replace(/\t/g, " ").replace(/\n/g, " ");
    rows.push(`${sec(m.timeSec)}\t${sec(m.timeSec + dur)}\t${name}`);
  }
  return rows.join("\n") + "\n";
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/__tests__/exporters-small.test.ts && npx vitest run && npx tsc --noEmit`
Expected: このファイル 9 passed、全体グリーン、型エラーなし

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/exporters/blenderPy.ts app/src/shared/exporters/reaperCsv.ts app/src/shared/exporters/nuendoCsv.ts app/src/shared/exporters/audacityTxt.ts app/src/shared/exporters/helpers.ts app/src/shared/__tests__/exporters-small.test.ts
git commit -m "feat(app): Blender/REAPER/Nuendo/Audacityエクスポータ"
```

---

### Task 13: WAV キューポイント埋め込みエクスポータ

**Files:**
- Create: `app/src/shared/exporters/wavCues.ts`
- Test: `app/src/shared/__tests__/exporters-wavcues.test.ts`

**Interfaces:**
- Consumes: `helpers.selectMarkers/ExportError`, `types.Marker/ExportContext`
- Produces:
  - `embedWavCues(wavBytes: Uint8Array, markers: Marker[], ctx: ExportContext): Uint8Array` — 元 WAV のコピーに `cue ` チャンクと `LIST`(adtl: 各マーカーの `labl`、リージョンは追加で `ltxt`)を書き込む(スペック §8)。仕様:
    - RIFF/WAVE を走査し、既存の `cue ` と `LIST(adtl)` は除去(再書き出しの重複防止)。**それ以外のチャンク(data / fmt / bext 等)はバイト無変更で保持**
    - サンプル位置 = `round(timeSec × fmtチャンクの sampleRate)`。cue ID は 1 起点の連番
    - `labl` テキストは UTF-8 + NUL 終端、チャンクは偶数長にパディング
    - リージョン(`meta.durationSec` あり)は `ltxt`(sampleLength、purpose `rgn `)も出す
    - RIFF 全体サイズを再計算。RIFF/WAVE でない・fmt が見つからない入力は `ExportError`

- [ ] **Step 1: 失敗するテストを書く**

`app/src/shared/__tests__/exporters-wavcues.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ExportError } from "../exporters/helpers.js";
import { embedWavCues } from "../exporters/wavCues.js";
import { FPS_PRESETS } from "../timebase.js";
import type { ExportContext, Marker } from "../types.js";

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    fps: FPS_PRESETS["30"]!, rounding: "nearest",
    include: ["section", "bar", "custom"],
    baseName: "track", sourceLabel: null, audioFileName: "track.wav",
    audioDurationSec: 2, bpmLabel: "120.00", keyLabel: "C major (8B)",
    beatsPerBar: 4, tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
    ...over,
  };
}

// ---- テスト用の最小WAVビルダ/リーダ ----
function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function u32le(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
}

function u16le(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff];
}

/** 22050Hz mono 16bit PCM、nサンプルのWAV */
function makeWav(nSamples: number, sampleRate = 22050): Uint8Array {
  const dataLen = nSamples * 2;
  const fmt = [
    ...ascii("fmt "), ...u32le(16),
    ...u16le(1), ...u16le(1), ...u32le(sampleRate),
    ...u32le(sampleRate * 2), ...u16le(2), ...u16le(16),
  ];
  const data = [...ascii("data"), ...u32le(dataLen), ...new Array(dataLen).fill(0x42)];
  const body = [...ascii("WAVE"), ...fmt, ...data];
  return new Uint8Array([...ascii("RIFF"), ...u32le(body.length), ...body]);
}

interface Chunk { id: string; start: number; size: number }

function chunks(bytes: Uint8Array): Chunk[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Chunk[] = [];
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.slice(pos, pos + 4));
    const size = dv.getUint32(pos + 4, true);
    out.push({ id, start: pos + 8, size });
    pos += 8 + size + (size % 2);
  }
  return out;
}

const MARKERS: Marker[] = [
  { id: "sec-0", sourceId: "s", timeSec: 0.5, type: "section", label: "サビ",
    color: "#e4547c", source: "auto", meta: { durationSec: 1.0 } },
  { id: "bar-1", sourceId: "s", timeSec: 1.0, type: "bar", label: "小節1",
    color: "#e8ebf0", source: "auto", meta: { barNumber: 1 } },
];

describe("embedWavCues", () => {
  it("cueチャンクとadtlが追加され、位置がサンプル単位で正しい", () => {
    const src = makeWav(44100); // 2秒
    const out = embedWavCues(src, MARKERS, ctx());
    const cs = chunks(out);
    const cue = cs.find((c) => c.id === "cue ")!;
    expect(cue).toBeDefined();
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(dv.getUint32(cue.start, true)).toBe(2); // マーカー数
    // 1個目: id=1, position=round(0.5*22050)=11025
    expect(dv.getUint32(cue.start + 4, true)).toBe(1);
    expect(dv.getUint32(cue.start + 8, true)).toBe(11025);
    // dwSampleOffset(cueレコード末尾)も同じ
    expect(dv.getUint32(cue.start + 4 + 20, true)).toBe(11025);
    const list = cs.find((c) => c.id === "LIST")!;
    expect(String.fromCharCode(...out.slice(list.start, list.start + 4))).toBe("adtl");
  });

  it("lablにUTF-8ラベル、リージョンにはltxt", () => {
    const out = embedWavCues(makeWav(44100), MARKERS, ctx());
    const text = new TextDecoder().decode(out);
    expect(text).toContain("labl");
    expect(text).toContain("サビ");
    expect(text).toContain("ltxt");
    expect(text).toContain("rgn ");
  });

  it("dataチャンクはバイト無変更・RIFFサイズ整合", () => {
    const src = makeWav(1000);
    const out = embedWavCues(src, MARKERS, ctx());
    const dataIn = chunks(src).find((c) => c.id === "data")!;
    const dataOut = chunks(out).find((c) => c.id === "data")!;
    expect(out.slice(dataOut.start, dataOut.start + dataOut.size))
      .toEqual(src.slice(dataIn.start, dataIn.start + dataIn.size));
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(dv.getUint32(4, true)).toBe(out.length - 8);
    expect(out.length % 2).toBe(0);
  });

  it("再埋め込みで既存cue/adtlが置き換わる(重複しない)", () => {
    const once = embedWavCues(makeWav(44100), MARKERS, ctx());
    const twice = embedWavCues(once, MARKERS, ctx());
    expect(chunks(twice).filter((c) => c.id === "cue ")).toHaveLength(1);
    expect(twice.length).toBe(once.length);
  });

  it("includeで絞られる", () => {
    const out = embedWavCues(makeWav(44100), MARKERS, ctx({ include: ["bar"] }));
    const cue = chunks(out).find((c) => c.id === "cue ")!;
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(dv.getUint32(cue.start, true)).toBe(1);
  });

  it("WAVでないバイト列はExportError", () => {
    expect(() => embedWavCues(new Uint8Array([1, 2, 3]), MARKERS, ctx())).toThrow(ExportError);
    const notWave = new Uint8Array([...ascii("RIFF"), ...u32le(4), ...ascii("AVI ")]);
    expect(() => embedWavCues(notWave, MARKERS, ctx())).toThrow(ExportError);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/shared/__tests__/exporters-wavcues.test.ts`
Expected: FAIL — `Cannot find module '../exporters/wavCues.js'`

- [ ] **Step 3: 実装**

`app/src/shared/exporters/wavCues.ts`:

```ts
/** WAV キューポイント埋め込み(スペック §8)。元 WAV のコピーに cue / LIST(adtl)
 *  チャンクを書き込む。音声データ自体は無変更なので位置ズレが原理的に起きない。
 *  Logic の「オーディオファイルからマーカーを読み込む」、REAPER のメディアキュー
 *  変換などで読める。 */
import type { ExportContext, Marker } from "../types.js";
import { ExportError, selectMarkers } from "./helpers.js";

const enc = new TextEncoder();

class ByteWriter {
  private parts: number[] = [];
  ascii(s: string) { for (const c of s) this.parts.push(c.charCodeAt(0)); }
  u16(v: number) { this.parts.push(v & 0xff, (v >> 8) & 0xff); }
  u32(v: number) {
    this.parts.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  }
  bytes(b: Uint8Array | number[]) { for (const x of b) this.parts.push(x); }
  get length(): number { return this.parts.length; }
  out(): Uint8Array { return new Uint8Array(this.parts); }
}

interface RawChunk { id: string; body: Uint8Array }

function parseWav(bytes: Uint8Array): { chunks: RawChunk[] } {
  if (bytes.length < 12) throw new ExportError("WAVとして短すぎます");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new ExportError("RIFF/WAVE ではありません");
  }
  const chunks: RawChunk[] = [];
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = tag(pos);
    const size = dv.getUint32(pos + 4, true);
    const body = bytes.slice(pos + 8, pos + 8 + size);
    chunks.push({ id, body });
    pos += 8 + size + (size % 2);
  }
  return { chunks };
}

function sampleRateOf(chunks: RawChunk[]): number {
  const fmt = chunks.find((c) => c.id === "fmt ");
  if (!fmt || fmt.body.length < 8) throw new ExportError("fmt チャンクがありません");
  const dv = new DataView(fmt.body.buffer, fmt.body.byteOffset, fmt.body.byteLength);
  return dv.getUint32(4, true);
}

function isAdtlList(c: RawChunk): boolean {
  return c.id === "LIST" && c.body.length >= 4 &&
    String.fromCharCode(...c.body.slice(0, 4)) === "adtl";
}

function zstrPadded(s: string): Uint8Array {
  const raw = enc.encode(s);
  const len = raw.length + 1;             // NUL終端
  const padded = len + (len % 2);         // 偶数長
  const out = new Uint8Array(padded);
  out.set(raw, 0);
  return out;
}

export function embedWavCues(
  wavBytes: Uint8Array, markers: Marker[], ctx: ExportContext,
): Uint8Array {
  const { chunks } = parseWav(wavBytes);
  const sr = sampleRateOf(chunks);
  const keep = chunks.filter((c) => c.id !== "cue " && !isAdtlList(c));
  const sel = selectMarkers(markers, ctx.include);

  // cue チャンク
  const cue = new ByteWriter();
  cue.u32(sel.length);
  sel.forEach((m, i) => {
    const sample = Math.round(m.timeSec * sr);
    cue.u32(i + 1);      // dwName (cue id)
    cue.u32(sample);     // dwPosition
    cue.ascii("data");   // fccChunk
    cue.u32(0);          // dwChunkStart
    cue.u32(0);          // dwBlockStart
    cue.u32(sample);     // dwSampleOffset
  });

  // LIST(adtl)
  const adtl = new ByteWriter();
  adtl.ascii("adtl");
  sel.forEach((m, i) => {
    const label = zstrPadded(m.label);
    adtl.ascii("labl");
    adtl.u32(4 + label.length);
    adtl.u32(i + 1);
    adtl.bytes(label);
    if (m.meta?.durationSec) {
      const lenSamples = Math.round(m.meta.durationSec * sr);
      adtl.ascii("ltxt");
      adtl.u32(20);        // テキストなしの固定部のみ
      adtl.u32(i + 1);
      adtl.u32(lenSamples);
      adtl.ascii("rgn ");
      adtl.u16(0); adtl.u16(0); adtl.u16(0); adtl.u16(0); // country/lang/dialect/codepage
    }
  });

  // 再構築
  const out = new ByteWriter();
  out.ascii("WAVE");
  for (const c of keep) {
    out.ascii(c.id);
    out.u32(c.body.length);
    out.bytes(c.body);
    if (c.body.length % 2 === 1) out.bytes([0]); // 奇数長チャンクは偶数へパディング
  }
  const cueBody = cue.out();
  out.ascii("cue ");
  out.u32(cueBody.length);
  out.bytes(cueBody);
  if (cueBody.length % 2 === 1) out.bytes([0]);
  const adtlBody = adtl.out();
  out.ascii("LIST");
  out.u32(adtlBody.length);
  out.bytes(adtlBody);
  if (adtlBody.length % 2 === 1) out.bytes([0]);

  const riffBody = out.out();
  const file = new ByteWriter();
  file.ascii("RIFF");
  file.u32(riffBody.length);
  file.bytes(riffBody);
  return file.out();
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/shared/__tests__/exporters-wavcues.test.ts && npx tsc --noEmit`
Expected: 6 passed、型エラーなし

- [ ] **Step 5: コミット**

```bash
cd /home/claude/beatmarks
git add app/src/shared/exporters/wavCues.ts app/src/shared/__tests__/exporters-wavcues.test.ts
git commit -m "feat(app): WAVキューポイント埋め込みエクスポータ"
```

---

### Task 14: エクスポータレジストリと統合ゴールデンテスト

**Files:**
- Create: `app/src/shared/exporters/index.ts`
- Create: `app/README.md`
- Create: `app/src/shared/__tests__/golden/`(ゴールデン出力、テストが生成→コミット)
- Test: `app/src/shared/__tests__/integration-golden.test.ts`

**Interfaces:**
- Consumes: これまでの全モジュール+`__fixtures__/analysis-30s.json`
- Produces:
  - `exporters/index.ts`:
    - `TEXT_EXPORTERS: Record<TextTargetKey, (m: Marker[], ctx: ExportContext) => string>`(json/csv/aejsx/premiere/resolve/blender/reaper/nuendo/audacity)
    - `runExport(target: TargetKey, markers: Marker[], ctx: ExportContext): { fileName: string; data: string | Uint8Array }` — midi は bytes、wavcues は `ExportError`(「embedWavCues を使う」)を投げる。fileName は `naming.buildFileName`
  - ゴールデン: `__tests__/golden/<target>-<fpsラベル>.<ext>`(テキスト系)+ `midi-<fpsラベル>.sha256` / `wavcues.sha256`(バイナリはハッシュ)。環境変数 `UPDATE_GOLDEN=1` で再生成、通常実行は完全一致比較

- [ ] **Step 1: レジストリを実装**

`app/src/shared/exporters/index.ts`:

```ts
/** ターゲット→エクスポータのレジストリ。UI(計画③)はここだけを呼ぶ。 */
import { buildFileName, type TargetKey } from "../naming.js";
import type { ExportContext, Marker } from "../types.js";
import { exportAudacityTxt } from "./audacityTxt.js";
import { exportAeJsx } from "./aejsx.js";
import { exportBlenderPy } from "./blenderPy.js";
import { exportCsv } from "./csv.js";
import { ExportError } from "./helpers.js";
import { exportJson } from "./json.js";
import { exportMidi } from "./midi.js";
import { exportNuendoCsv } from "./nuendoCsv.js";
import { exportPremiereXml } from "./premiereXml.js";
import { exportReaperCsv } from "./reaperCsv.js";
import { exportResolveEdl } from "./resolveEdl.js";

export type TextTargetKey = Exclude<TargetKey, "midi" | "wavcues">;

export const TEXT_EXPORTERS: Record<
  TextTargetKey, (m: Marker[], ctx: ExportContext) => string
> = {
  json: exportJson,
  csv: exportCsv,
  aejsx: exportAeJsx,
  premiere: exportPremiereXml,
  resolve: exportResolveEdl,
  blender: exportBlenderPy,
  reaper: exportReaperCsv,
  nuendo: exportNuendoCsv,
  audacity: exportAudacityTxt,
};

export function runExport(
  target: TargetKey, markers: Marker[], ctx: ExportContext,
): { fileName: string; data: string | Uint8Array } {
  const fileName = buildFileName(ctx.baseName, ctx.sourceLabel, target);
  if (target === "wavcues") {
    throw new ExportError("wavcues は embedWavCues(wavBytes, markers, ctx) を直接使う");
  }
  if (target === "midi") {
    return { fileName, data: exportMidi(markers, ctx) };
  }
  return { fileName, data: TEXT_EXPORTERS[target](markers, ctx) };
}
```

- [ ] **Step 2: 統合ゴールデンテストを書く**

`app/src/shared/__tests__/integration-golden.test.ts`:

```ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { deriveMarkers } from "../deriveMarkers.js";
import { runExport, TEXT_EXPORTERS, type TextTargetKey } from "../exporters/index.js";
import { embedWavCues } from "../exporters/wavCues.js";
import { TARGETS } from "../naming.js";
import { FPS_PRESETS } from "../timebase.js";
import { defaultEditState, parseEngineResult } from "../validate.js";
import type { ExportContext, Marker } from "../types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "golden");
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

// ---- fixture から現実的なマーカー列を作る(編集も少し混ぜる) ----
const engine = parseEngineResult(
  readFileSync(join(HERE, "..", "__fixtures__", "analysis-30s.json"), "utf-8"),
);
const edits = {
  ...defaultEditState(),
  hitThreshold: { low: 0.5, mid: 0.5, high: 0.5 }, // ヒットを間引いてゴールデンを読みやすく
  sectionEdits: [{ op: "rename" as const, index: 0, label: "イントロ" }],
  customMarkers: [{
    id: "custom-1", sourceId: "mix", timeSec: 7.5, type: "custom" as const,
    label: "カメラフラッシュ", color: "#ffd166", source: "user" as const,
  }],
};
const markers: Marker[] = deriveMarkers(engine.analysis, edits, "mix");

function ctxFor(fpsKey: "30" | "29.97"): ExportContext {
  return {
    fps: FPS_PRESETS[fpsKey]!, rounding: "nearest",
    include: ["section", "bar", "hit", "silence", "custom"], // beatは多いので除外
    baseName: "fixture30", sourceLabel: null, audioFileName: "fixture30.wav",
    audioDurationSec: engine.analysis.durationSec,
    bpmLabel: engine.analysis.bpm ? engine.analysis.bpm.toFixed(2) : "可変",
    keyLabel: `${engine.analysis.key.global.name} (${engine.analysis.key.global.camelot})`,
    beatsPerBar: 4, tempoMap: engine.analysis.tempoMap,
    envelopes: engine.analysis.envelopes,
  };
}

function checkGolden(name: string, content: string | Uint8Array): void {
  const isText = typeof content === "string";
  const path = join(GOLDEN, name);
  if (UPDATE) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(path, isText ? content : sha256(content));
    return;
  }
  expect(existsSync(path), `golden missing: ${name}(UPDATE_GOLDEN=1 で生成)`).toBe(true);
  const expected = readFileSync(path, "utf-8");
  expect(isText ? content : sha256(content)).toBe(expected);
}

function sha256(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

describe("統合ゴールデン(fixture→derive→全エクスポータ)", () => {
  const textTargets = Object.keys(TEXT_EXPORTERS) as TextTargetKey[];

  for (const fpsKey of ["30", "29.97"] as const) {
    for (const target of textTargets) {
      it(`${target} @${fpsKey}fps`, () => {
        const { fileName, data } = runExport(target, markers, ctxFor(fpsKey));
        expect(fileName).toContain(TARGETS[target].abbr);
        checkGolden(`${target}-${fpsKey}.${TARGETS[target].ext}`, data);
      });
    }
    it(`midi @${fpsKey}fps`, () => {
      const { data } = runExport("midi", markers, ctxFor(fpsKey));
      expect((data as Uint8Array).length).toBeGreaterThan(100);
      checkGolden(`midi-${fpsKey}.sha256`, data as Uint8Array);
    });
  }

  it("wavcues(決定的な合成WAVに埋め込み)", () => {
    // 22050Hz/1chの無音WAVをテスト内で決定的に構築
    const sr = 22050;
    const n = Math.round(engine.analysis.durationSec * sr);
    const header = new Uint8Array(44 + n * 2);
    const dv = new DataView(header.buffer);
    const w = (o: number, s: string) => [...s].forEach((c, i) => header[o + i] = c.charCodeAt(0));
    w(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); w(8, "WAVE");
    w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    w(36, "data"); dv.setUint32(40, n * 2, true);
    const out = embedWavCues(header, markers, ctxFor("30"));
    checkGolden("wavcues.sha256", out);
  });

  it("マーカー導出はfixtureに対して安定", () => {
    expect(markers.length).toBeGreaterThan(10);
    const again = deriveMarkers(engine.analysis, edits, "mix");
    expect(again).toEqual(markers);
  });
});
```

- [ ] **Step 3: ゴールデンを生成して確認**

```bash
cd /home/claude/beatmarks/app
UPDATE_GOLDEN=1 npx vitest run src/shared/__tests__/integration-golden.test.ts
npx vitest run src/shared/__tests__/integration-golden.test.ts
ls src/shared/__tests__/golden/
cp src/shared/__tests__/golden/aejsx-30.jsx /tmp/aejsx-check.js && node --check /tmp/aejsx-check.js && echo "aejsx golden: syntax OK"
```

Expected: 1回目で golden/ に **21 ファイル**(テキスト 9 種×2fps=18 + midi の sha256×2 + wavcues の sha256×1)が生成され、2回目は全テスト passed。`node --check` が通る(エンベロープ焼き込み込みの実サイズ .jsx が構文的に妥当である確認)

生成後、**ゴールデンの中身を目視確認**する(特に aejsx-30.jsx が AE スクリプトの体裁か、resolve-30.edl の TC・色名が妥当か、premiere-29.97.xml の ntsc=TRUE)。異常があれば実装を修正して再生成。

- [ ] **Step 4: README を書く**

`app/README.md`:

```markdown
# BeatMarks App (shared library)

計画②の成果物: マーカー導出+11形式のエクスポータ(純関数、Electron 非依存)。

## 開発

    cd app
    npm install
    npm test          # vitest
    npm run typecheck # tsc --noEmit

ゴールデン更新(出力仕様を意図的に変えたときのみ):

    UPDATE_GOLDEN=1 npx vitest run src/shared/__tests__/integration-golden.test.ts

## 使い方(計画③のUIから)

    import { parseEngineResult, defaultEditState } from "./shared/validate.js";
    import { deriveMarkers } from "./shared/deriveMarkers.js";
    import { runExport } from "./shared/exporters/index.js";
    import { embedWavCues } from "./shared/exporters/wavCues.js";

    const { analysis } = parseEngineResult(engineJson);
    const markers = deriveMarkers(analysis, edits, sourceId);
    const { fileName, data } = runExport("aejsx", markers, ctx); // 文字列 or bytes
    // WAVキューのみ: embedWavCues(wavBytes, markers, ctx)

## ターゲットと略称(スペック §8)

| target | 略称 | 拡張子 | 備考 |
|---|---|---|---|
| json / csv / midi | markers | json / csv / mid | 正規形式・汎用 |
| aejsx | AE | jsx | ES3・matchName・エンベロープ焼き込み |
| premiere | PPro | xml | xmeml v4 |
| resolve | Resolve | edl | マーカーEDL(CRLF) |
| blender | Blender | py | fps/fps_base設定つき |
| wavcues | cues | wav | 元WAVにcue/adtl埋め込み |
| reaper | REAPER | csv | タブ区切り(X-Raymスクリプトで読み込み) |
| nuendo | Nuendo | csv | TC列。24/25/29.97/30fpsのみ |
| audacity | Audacity | txt | ラベルトラック |
```

- [ ] **Step 5: 全テスト・型チェック・コミット**

Run: `cd /home/claude/beatmarks/app && npx vitest run && npx tsc --noEmit`
Expected: 全テスト passed(Task 1〜14 の合計)、型エラーなし

```bash
cd /home/claude/beatmarks
git add app/
git commit -m "feat(app): エクスポータレジストリ・統合ゴールデン・README"
```

---

## 完了条件(計画②)

- `cd app && npx vitest run` が全件グリーン、`npx tsc --noEmit` がエラーなし
- fixture(エンジン実出力)→ `deriveMarkers` → 11 形式すべてのゴールデンが安定して一致する
- 29.97fps のゴールデンで TC・フレーム番号が分数計算になっている(30fps 版との差分で確認できる)
- 生成した `aejsx` ゴールデンが `node --check` を通る(ES3 構文)
- ランタイム依存ゼロ(`app/package.json` の `dependencies` が存在しないか空)

## この計画がやらないこと(後続計画の責務)

- ファイルへの書き出し・保存ダイアログ・複数ターゲット一括出力の UI(計画③ アプリ編。ここは文字列/bytes を返すまで)
- ffmpeg・エンジン起動・`.bmk` プロジェクト保存(計画③)
- 実ソフト(AE / Resolve / REAPER / Logic 等)への読み込み手動 QA(計画③の manual-qa.md で実施。ゴールデンは形式の安定性を守るが、実アプリ互換の最終確認は実機)
- C4D / Houdini / Maya / 3dsMax / Unity / Unreal(Phase 2)





