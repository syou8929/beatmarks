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
    async function save(): Promise<void> {
      if (state.phase !== "editor") return;
      const path = await getIpc().saveProject(toProjectFileState(state.project), state.projectPath);
      dispatch({ type: "SAVED", path });
    }
    async function saveAs(): Promise<void> {
      if (state.phase !== "editor") return;
      const path = await getIpc().saveProject(toProjectFileState(state.project), null);
      dispatch({ type: "SAVED", path });
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
