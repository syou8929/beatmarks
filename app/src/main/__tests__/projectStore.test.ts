import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ProjectFileState } from "../../shared/ipc.js";
import { openProjectFrom, saveProjectTo, validateProjectFile } from "../projectStore.js";

const dir = mkdtempSync(join(tmpdir(), "bmproj-"));

function state(): ProjectFileState {
  return {
    version: 1,
    mediaPath: "/media/track.mp4",
    mediaHash: "a".repeat(64),
    baseName: "track",
    playbackWavPath: "/tmp/playback.wav",
    durationSec: 30,
    sources: [],
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

  it("壊れたJSONの.bmkはエラー", async () => {
    const bad = join(dir, "bad.bmk");
    writeFileSync(bad, "{not json");
    await expect(openProjectFrom(bad)).rejects.toThrow();
  });

  it("保存はJSONとして再パース可能", async () => {
    const p = await saveProjectTo(state(), join(dir, "re.bmk"));
    expect(() => JSON.parse(readFileSync(p, "utf-8"))).not.toThrow();
  });
});
