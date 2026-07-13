/** ピーク計算 Worker(electron-vite の `new Worker(new URL(...), {type:"module"})` で起動)。
 *  受信 {type:"build", channel, sampleRate} → 送信 {type:"done", peaks}(min/max を transfer)。 */
import { buildPeakSet } from "./peaks.js";

interface BuildMsg { type: "build"; channel: Float32Array; sampleRate: number }

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<BuildMsg>) => void) | null;
  postMessage: (msg: unknown, transfer: Transferable[]) => void;
};

ctx.onmessage = (e) => {
  if (e.data.type !== "build") return;
  const peaks = buildPeakSet(e.data.channel, e.data.sampleRate);
  const transfer: Transferable[] = [];
  for (const lv of peaks.levels) transfer.push(lv.min.buffer, lv.max.buffer);
  ctx.postMessage({ type: "done", peaks }, transfer);
};
