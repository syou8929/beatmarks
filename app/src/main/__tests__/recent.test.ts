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
