/** 時刻の表示/入力変換(スペック §7)。単位: 秒(ms精度)/ フレーム / タイムコード / 小節.拍。 */
import type { GridBeat } from "../../shared/deriveGrid.js";
import { formatTimecode, frameToTime, timeToFrame } from "../../shared/timebase.js";
import type { Fps } from "../../shared/types.js";

export type TimeUnit = "sec" | "frame" | "tc" | "barBeat";
export interface TimeCtx {
  fps: Fps;
  grid: GridBeat[];
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, "0");
}

function nearestBeat(grid: GridBeat[], sec: number): GridBeat | null {
  if (grid.length === 0) return null;
  let best = grid[0]!;
  let bestD = Math.abs(best.timeSec - sec);
  for (const g of grid) {
    const d = Math.abs(g.timeSec - sec);
    if (d < bestD) { best = g; bestD = d; }
  }
  return best;
}

function barBeatOf(grid: GridBeat[], g: GridBeat): { bar: number; beat: number } {
  // g と同じ小節の小節頭(isBar, 同 barNumber, index ≤ g.index)を探し拍番号を数える
  let barStart = g;
  for (const b of grid) {
    if (b.isBar && b.barNumber === g.barNumber && b.index <= g.index) barStart = b;
  }
  return { bar: g.barNumber, beat: g.index - barStart.index + 1 };
}

export function formatTime(sec: number, unit: TimeUnit, ctx: TimeCtx): string {
  switch (unit) {
    case "sec": {
      const ms = Math.round(Math.max(0, sec) * 1000);
      return `${Math.floor(ms / 60000)}:${pad(Math.floor((ms % 60000) / 1000), 2)}.${pad(ms % 1000, 3)}`;
    }
    case "frame":
      return String(timeToFrame(sec, ctx.fps, "nearest"));
    case "tc":
      return formatTimecode(timeToFrame(sec, ctx.fps, "nearest"), ctx.fps);
    case "barBeat": {
      const g = nearestBeat(ctx.grid, sec);
      if (!g) return "–";
      const { bar, beat } = barBeatOf(ctx.grid, g);
      return `${bar}.${beat}`;
    }
  }
}

export function parseTime(text: string, unit: TimeUnit, ctx: TimeCtx): number | null {
  const t = text.trim();
  switch (unit) {
    case "sec": {
      const m = t.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
      if (!m) return null;
      const mins = m[1] ? parseInt(m[1], 10) : 0;
      const secs = parseFloat(m[2]!);
      return Number.isFinite(secs) ? mins * 60 + secs : null;
    }
    case "frame": {
      if (!/^\d+$/.test(t)) return null;
      return frameToTime(parseInt(t, 10), ctx.fps);
    }
    case "tc": {
      const m = t.match(/^(\d+):(\d+):(\d+):(\d+)$/);
      if (!m) return null;
      const base = Math.ceil(ctx.fps.num / ctx.fps.den);
      const [hh, mm, ss, ff] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!];
      if (ff >= base) return null;
      return frameToTime((hh * 3600 + mm * 60 + ss) * base + ff, ctx.fps);
    }
    case "barBeat": {
      const m = t.match(/^(-?\d+)\.(\d+)$/);
      if (!m) return null;
      const bar = +m[1]!;
      const beat = +m[2]!;
      const barStart = ctx.grid.find((b) => b.isBar && b.barNumber === bar);
      if (!barStart || beat < 1) return null;
      const target = ctx.grid.find((b) => b.index === barStart.index + (beat - 1) && b.barNumber === bar);
      return target ? target.timeSec : null;
    }
  }
}
