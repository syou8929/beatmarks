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
    beatsPerBar: 4, timeSigDenominator: 4, tempoMap: [{ timeSec: 0, bpm: 120 }], envelopes: null,
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
    // 拡張子は .js: Node 22 の `--check` は ESM ローダー経由でフォーマット判定するため
    // 未知の拡張子(.jsx 含む)は内容に関係なく ERR_UNKNOWN_FILE_EXTENSION になる。
    // 中身はプレーンな ES3 で React 由来の JSX 構文ではないため、実体は変わらない。
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

  it("丸めで同フレームに衝突しても優先度の高い種別が残る", () => {
    const collide: Marker[] = [
      { id: "h", sourceId: "s", timeSec: 0.26, type: "hit", label: "low",
        color: "#ff7847", source: "auto", meta: { strength: 0.9, band: "low" } },
      { id: "b", sourceId: "s", timeSec: 0.27, type: "bar", label: "小節1",
        color: "#e8ebf0", source: "auto", meta: { barNumber: 1 } },
    ];
    // どちらも frame 8 (round(0.26*30)=round(0.27*30)=8) → bar(優先度1)が勝つ
    const code = exportAeJsx(collide, ctx());
    const pushes = code.match(/BM_MARKERS\.push/g) ?? [];
    expect(pushes).toHaveLength(1);
    expect(code).toContain("\\u5c0f\\u7bc0"); // 「小節」= barのラベル
    expect(code).not.toContain("'low'");
  });

  it("レイヤーマーカーは文書化されたaudioLayer.markerを使う", () => {
    const code = exportAeJsx(MARKERS, ctx());
    expect(code).toContain("audioLayer.marker;");
    expect(code).not.toContain("property('Marker')");
  });

  it("生成コードは\\uエスケープ外の非ASCIIを含まない", () => {
    const code = exportAeJsx(MARKERS, ctx());
    expect(/[^\x00-\x7f]/.test(code)).toBe(false);
  });
});
