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
