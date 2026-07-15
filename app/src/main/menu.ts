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
      // 取り消し/やり直しは意図的に accelerator を付けない(③b Task 12 レビュー)。
      // macOS はメニューのキー等価をシステムレベルで扱うため、テキスト入力(リネーム欄等)に
      // フォーカス中でも accelerator があればメニュー側の click が発火してしまう
      // (Menu#registerAccelerator:false は Win/Linux にしか効かず macOS には無力)。
      // renderer 側の window keydown リスナー(keymap.ts の isTextInput ガード付き、
      // EditorScreen.tsx 配線)を ⌘Z/⇧⌘Z の唯一のキーボード所有者とし、二重発火
      // (テキスト入力中の意図しないapp-undo、または1回の⌘Zで2回undoされる等)を防ぐ。
      // click ハンドラ(マウスでのメニュー操作)はそのまま残す — 唯一のキーボード
      // 所有者が要るだけで、メニュー自体を無効化する話ではない。
      // ③c の E2E(Playwright+xvfb, packaged app)で「1回の⌘Zにつき1回だけundoされる」ことを
      // 実機検証すること(このガードは unit テストでは accelerator 不在の確認までしかできない)。
      { label: "取り消し", click: () => h.onUndo() },
      { label: "やり直し", click: () => h.onRedo() },
      { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" },
    ],
  });
  return template;
}
