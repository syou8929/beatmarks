/** メニュー由来のファイル操作(開く/保存/別名/最近)とダーティ・タイトルを配線するフック。
 *  undo/redo のメニューイベントは T12(EditorScreen)がソース横断考慮つきで別途購読する。 */
import { useEffect } from "react";

import type { OpenProjectOutcome } from "../../shared/ipc.js";
import { getIpc } from "../ipc.js";
import type { Action, AppState } from "../state/store.js";
import { toProjectFileState } from "../state/projectFile.js";
import { STRINGS } from "../strings.js";

export function useProjectFile(state: AppState, dispatch: (a: Action) => void): void {
  useEffect(() => {
    // save/saveAs の結果処理を共通化。main の saveProject(main/index.ts)は保存ダイアログが
    // キャンセルされると Error("保存がキャンセルされました") を投げる契約になっており、
    // これは異常系ではなくごく普通の操作なので、他のIPC呼び出し失敗と同様に扱って
    // unhandled rejection にしてしまうのではなく、無音で無視する(isDirtyは維持=次の
    // 保存操作を促す)。メッセージ文字列での判定は暫定実装 — ③cでmain側がSaveOutcome等の
    // 型付き結果を返すよう変更し、message-sniffingをやめるのが望ましい。
    async function finishSave(pathPromise: Promise<string>): Promise<void> {
      try {
        const path = await pathPromise;
        dispatch({ type: "SAVED", path });
      } catch (err) {
        if (err instanceof Error && err.message.includes("キャンセル")) return;
        alert(String(err));
      }
    }
    async function save(): Promise<void> {
      if (state.phase !== "editor") return;
      await finishSave(getIpc().saveProject(toProjectFileState(state.project), state.projectPath));
    }
    async function saveAs(): Promise<void> {
      if (state.phase !== "editor") return;
      await finishSave(getIpc().saveProject(toProjectFileState(state.project), null));
    }
    function load(outcome: OpenProjectOutcome | null): void {
      if (!outcome) return;
      if (!outcome.ok) { alert(outcome.message); return; }
      if (outcome.hashMismatch &&
          !window.confirm(`${STRINGS.menu.hashMismatchTitle}\n${STRINGS.menu.hashMismatch}`)) {
        return;
      }
      dispatch({ type: "PROJECT_LOADED", state: outcome.state, path: outcome.path, playbackWavPath: outcome.playbackWavPath });
    }
    async function open(): Promise<void> { load(await getIpc().openProject()); }
    async function openPath(p: string): Promise<void> { load(await getIpc().openProjectByPath(p)); }

    return getIpc().onMenu((ev) => {
      if (ev.action === "save") void save();
      else if (ev.action === "saveAs") void saveAs();
      else if (ev.action === "open") void open();
      else if (ev.action === "openRecent") void openPath(ev.path);
      // undo/redo は T12 が処理
    });
  }, [state, dispatch]);

  // タイトル(ダーティは • を付与)
  useEffect(() => {
    document.title = state.phase === "editor"
      ? `${state.project.baseName}${state.isDirty ? " •" : ""} - ${STRINGS.app.name}`
      : STRINGS.app.name;
  }, [state]);
}
