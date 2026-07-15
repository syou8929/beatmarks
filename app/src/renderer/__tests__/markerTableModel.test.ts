import { describe, expect, it } from "vitest";

import {
  activeRows, deletedRows, filterByType, isMutable, rowLabel, sectionIndexFromMarkerId, typeLabel,
} from "../editor/markerTableModel.js";
import { defaultEditState } from "../../shared/validate.js";
import type { SourceState } from "../state/store.js";
import type { AnalysisResult, Marker } from "../../shared/types.js";

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
    // ブリーフ原文は `typeLabel({ ...({} as never), type: "section" })` だったが、この
    // プロジェクトの strict tsconfig では "Spread types may only be created from object
    // types" で tsc が落ちる(never のスプレッドは不可)。テストの意図(type だけ見て他の
    // フィールドは無視されることの確認)を保ったまま、最小限だが型的に正しい Marker を渡す。
    const sec: Marker = { id: "s0", sourceId: "mix", timeSec: 0, type: "section", label: "A", color: "#000", source: "auto" };
    expect(typeLabel(sec)).toBe("セクション");
  });

  // 以下はブリーフに無い追加分(実装検証の過程で見つけた欠落カバレッジ)。

  it("typeLabel: hit は帯域名を含む(strings.ts 経由で組み立てる)", () => {
    const base = { id: "x", sourceId: "mix", timeSec: 0, type: "hit" as const, label: "low", color: "#000", source: "auto" as const };
    expect(typeLabel({ ...base, meta: { band: "low" } })).toBe("ヒット（低）");
    expect(typeLabel({ ...base, meta: { band: "mid" } })).toBe("ヒット（中）");
    expect(typeLabel({ ...base, meta: { band: "high" } })).toBe("ヒット（高）");
  });

  it("rowLabel: hit は強度表示、それ以外はラベルそのまま", () => {
    const hit: Marker = {
      id: "h", sourceId: "mix", timeSec: 0, type: "hit", label: "low", color: "#000", source: "auto",
      meta: { strength: 0.5 },
    };
    expect(rowLabel(hit)).toBe("強度 0.50");
    const sec: Marker = { id: "s1", sourceId: "mix", timeSec: 0, type: "section", label: "Verse", color: "#000", source: "auto" };
    expect(rowLabel(sec)).toBe("Verse");
  });

  it("isMutable: 行のマーカーが activeSourceId 由来かどうかを判定する(ソース横断の誤操作防止)", () => {
    const rows = activeRows(src);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(isMutable(r, "mix")).toBe(true);
    expect(isMutable(rows[0]!, "other-source")).toBe(false);
  });
});
