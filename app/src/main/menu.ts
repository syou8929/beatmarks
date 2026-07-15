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

const MAX_RECENT = 5;

export function buildMenuTemplate(h: MenuHandlers, recent: string[]): MenuItemConstructorOptions[] {
  const isMac = process.platform === "darwin";
  // recent.ts の addRecent/loadRecent は既に5件に切り詰めているが、buildMenuTemplate
  // 単体で呼ばれた場合(テスト等)にも壊れないよう、ここでも防御的に切り詰める。
  const capped = recent.slice(0, MAX_RECENT);
  const recentSub: MenuItemConstructorOptions[] = capped.length
    ? capped.map((p) => ({ label: p, click: () => h.onOpenRecent(p) }))
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
