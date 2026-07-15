import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ProjectFileState } from "../../shared/ipc.js";
import type { AnalysisResult } from "../../shared/types.js";
import { defaultEditState } from "../../shared/validate.js";
import { openProjectFrom, saveProjectTo, validateProjectFile } from "../projectStore.js";

const dir = mkdtempSync(join(tmpdir(), "bmproj-"));

function analysis(): AnalysisResult {
  return {
    durationSec: 30, tempoMode: "fixed", bpm: 120, gridOffsetSec: 0.25, beats: [0.25], downbeatPhase: 0,
    tempoMap: [], key: { global: { name: "C major", camelot: "8B", confidence: 1 }, perSection: [] },
    sections: [], hits: [], silences: [], envelopes: { sampleRateHz: 100, total: [], low: [], mid: [], high: [] },
  };
}

// sources を空にせず activeSourceId="mix" と整合させる(台帳追加要件: activeSourceId の
// 相互参照検証を導入したため、以前の sources:[] + activeSourceId:"mix" という
// 内部矛盾したフィクスチャは validateProjectFile を通らなくなった)。
function state(): ProjectFileState {
  return {
    version: 1,
    mediaPath: "/media/track.mp4",
    mediaHash: "a".repeat(64),
    baseName: "track",
    durationSec: 30,
    input: { mode: "mix", trackIndexes: [0], channelSplit: "mono" },
    sources: [{ source: { id: "mix", kind: "mix", label: "2mix" }, analysis: analysis(), edits: defaultEditState() }],
    activeSourceId: "mix",
    ui: { fps: { num: 30, den: 1 }, rounding: "nearest" },
  };
}

describe("projectStore", () => {
  it("保存→読込がラウンドトリップし.bmkが強制される", async () => {
    const p = await saveProjectTo(state(), join(dir, "proj"));
    expect(p.endsWith(".bmk")).toBe(true);
    const loaded = await openProjectFrom(p);
    expect(loaded.state).toEqual(state());
    expect(loaded.path).toBe(p);
  });

  it("validateProjectFile: version違いは明示エラー", () => {
    expect(() => validateProjectFile({ ...state(), version: 2 })).toThrow(/version/);
    expect(() => validateProjectFile("junk")).toThrow();
    expect(() => validateProjectFile({ version: 1 })).toThrow();
  });

  it("validateProjectFile: ui が配列だとエラー(typeof [] === 'object'の抜け穴)", () => {
    expect(() => validateProjectFile({ ...state(), ui: [] })).toThrow(/ui/);
  });

  it("壊れたJSONの.bmkはエラー", async () => {
    const bad = join(dir, "bad.bmk");
    writeFileSync(bad, "{not json");
    await expect(openProjectFrom(bad)).rejects.toThrow();
  });

  it("保存はJSONとして再パース可能", async () => {
    const p = await saveProjectTo(state(), join(dir, "re.bmk"));
    expect(() => JSON.parse(readFileSync(p, "utf-8"))).not.toThrow();
  });

  it("保存はアトミック(tmpに書いてrename): 完了後に.tmp-*が残らない", async () => {
    const p = await saveProjectTo(state(), join(dir, "atomic"));
    expect(existsSync(p)).toBe(true);
    const stray = readdirSync(dir).filter((f) => f.includes(".tmp-"));
    expect(stray).toEqual([]);
  });
});
