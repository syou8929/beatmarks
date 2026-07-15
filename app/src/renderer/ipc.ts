import type { AnalyzeProgressEvent, IpcApi, MenuEvent } from "../shared/ipc.js";

type Bridge = IpcApi & {
  onAnalyzeProgress(cb: (ev: AnalyzeProgressEvent) => void): () => void;
  onMenu(cb: (ev: MenuEvent) => void): () => void;
};

export function getIpc(): Bridge {
  const api = (window as unknown as { beatmarks?: Bridge }).beatmarks;
  if (!api) throw new Error("preload ブリッジが見つかりません(beatmarks)");
  return api;
}
