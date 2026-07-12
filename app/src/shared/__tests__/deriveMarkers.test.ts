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

describe("IDの安定性(レビュー強化)", () => {
  it("セクションIDは他セクションの削除を跨いで安定", () => {
    const base = deriveMarkers(analysis(), edits(), "s");
    const secB = byType(base, "section")[1]!; // 元index=1のB
    expect(secB.id).toBe("sec-o1");
    // Bをid指定で削除 → その後Aをedit削除しても、消えるのはBのままAが残る
    const ms = deriveMarkers(
      analysis(),
      edits({
        deletedMarkerIds: [secB.id],
        sectionEdits: [{ op: "delete", index: 0 }],
      }),
      "s",
    );
    expect(byType(ms, "section")).toHaveLength(0); // A=edit削除, B=id削除
  });

  it("追加セクションはsec-a{n}", () => {
    const ms = deriveMarkers(
      analysis(),
      edits({ sectionEdits: [{ op: "add", startSec: 2.25, label: "間奏", color: "#888888" }] }),
      "s",
    );
    expect(byType(ms, "section").map((m) => m.id)).toContain("sec-a0");
  });

  it("不正indexのsectionEditは無視される", () => {
    const ms = deriveMarkers(
      analysis(),
      edits({ sectionEdits: [{ op: "rename", index: 99, label: "x" }] }),
      "s",
    );
    expect(byType(ms, "section").map((m) => m.label)).toEqual(["A", "B ★"]);
  });

  it("同時刻マーカーはTYPE_ORDER順", () => {
    const custom = {
      id: "c1", sourceId: "s", timeSec: 0.25, type: "custom" as const,
      label: "同時刻", color: "#ffd166", source: "user" as const,
    };
    const ms = deriveMarkers(analysis(), edits({ customMarkers: [custom] }), "s");
    const at025 = ms.filter((m) => m.timeSec === 0.25).map((m) => m.type);
    expect(at025).toEqual(["bar", "beat", "hit", "custom"]);
  });
});

describe("範囲外セクション編集のクランプ(最終レビュー対応)", () => {
  it("durationSec超のmoveでも負のdurationが生まれない", () => {
    const ms = deriveMarkers(
      analysis(),
      edits({ sectionEdits: [{ op: "move", index: 1, startSec: 15 }] }),
      "s",
    );
    const secs = byType(ms, "section");
    for (const s of secs) {
      expect(s.timeSec).toBeGreaterThanOrEqual(0);
      expect(s.timeSec).toBeLessThanOrEqual(10);
      expect(s.meta!.durationSec!).toBeGreaterThanOrEqual(0);
    }
  });

  it("負のstartSecのaddは0にクランプ", () => {
    const ms = deriveMarkers(
      analysis(),
      edits({ sectionEdits: [{ op: "add", startSec: -3, label: "前奏", color: "#888888" }] }),
      "s",
    );
    const secs = byType(ms, "section");
    expect(secs[0]!.timeSec).toBe(0);
    expect(secs.every((s) => s.timeSec >= 0)).toBe(true);
  });
});
