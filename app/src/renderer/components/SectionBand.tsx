/** セクション帯(スペック §7 ④): 色帯・小節数・境界ドラッグ・ダブルクリックリネーム・削除・境界追加。
 *  モックの sectionlane 相当。実 store 接続は EditorScreen(T12)がコールバックを配線する。 */
import React, { useState } from "react";

import { resolveBoundaryDrag, sectionIndexFromId } from "../editor/sectionGeom.js";
import { secToPx, type Viewport } from "../editor/waveGeom.js";
import { STRINGS } from "../strings.js";

const S = STRINGS.section;

export interface SectionView {
  id: string;
  startSec: number;
  durationSec: number;
  label: string;
  color: string;
}

export interface SectionBandProps {
  sections: SectionView[];
  viewport: Viewport;
  barIntervalSec: number;
  playheadSec: number;
  snap: (sec: number) => number; // ⌘バイパスは呼び出し側で恒等を渡す
  onMoveBoundary: (index: number, sec: number) => void; // index=元セクション添字
  onRename: (index: number, label: string) => void;
  onDelete: (id: string) => void;
  onAddAtPlayhead: () => void;
}

const MIN_GAP = 0.1;

export function SectionBand(props: SectionBandProps): React.JSX.Element {
  const { sections, viewport: vp } = props;
  const [editing, setEditing] = useState<{ index: number; value: string } | null>(null);

  function commitRename(): void {
    if (editing) { props.onRename(editing.index, editing.value); setEditing(null); }
  }

  /** i番目セクションの右ハンドルドラッグ = i+1番目セクションの startSec を動かす。 */
  function handleDrag(i: number, e: React.PointerEvent): void {
    const next = sections[i + 1];
    if (!next) return;
    const targetIndex = sectionIndexFromId(next.id);
    if (targetIndex === null) return; // 追加セクションは移動不可(Phase2)
    const el = (e.currentTarget as HTMLElement).closest("[data-sectionband]") as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    const prevSec = sections[i]!.startSec;
    const nextSec = sections[i + 2]?.startSec ?? next.startSec + next.durationSec;
    const move = (ev: PointerEvent) => {
      const x = rect ? ev.clientX - rect.left : ev.clientX;
      const sec = resolveBoundaryDrag(x, vp, prevSec, nextSec, MIN_GAP, ev.ctrlKey || ev.metaKey ? (s) => s : props.snap);
      props.onMoveBoundary(targetIndex, sec);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div data-sectionband style={{ position: "relative", height: 26, margin: "6px 14px 0" }}>
      {sections.map((s, i) => {
        const left = Math.max(0, secToPx(s.startSec, vp));
        const right = Math.min(vp.widthPx, secToPx(s.startSec + s.durationSec, vp));
        const bars = Math.round(s.durationSec / props.barIntervalSec);
        if (right <= left) return null;
        return (
          <div
            key={s.id}
            style={{
              position: "absolute", top: 0, height: "100%", left, width: right - left,
              background: s.color, borderRadius: "5px 5px 0 0", display: "flex", alignItems: "center",
              padding: "0 8px", fontWeight: 700, fontSize: 11, color: "#fff", overflow: "hidden",
              whiteSpace: "nowrap", cursor: "grab",
            }}
            title={S.editHint}
          >
            {editing?.index === i ? (
              <input
                autoFocus
                value={editing.value}
                onChange={(e) => setEditing({ index: i, value: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(null); }}
                onBlur={commitRename}
                style={{ font: "inherit", width: "100%", background: "rgba(0,0,0,.3)", color: "#fff", border: "none" }}
              />
            ) : (
              <span onDoubleClick={() => setEditing({ index: i, value: s.label })}>
                {s.label}<small style={{ fontWeight: 400, opacity: 0.8, marginLeft: 6 }}>{bars}{S.barsSuffix}</small>
              </span>
            )}
            <button
              title={S.delete}
              onClick={() => props.onDelete(s.id)}
              style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#fff", cursor: "pointer", fontSize: 11 }}
            >{S.deleteGlyph}</button>
            {i < sections.length - 1 && (
              <span
                onPointerDown={(e) => handleDrag(i, e)}
                style={{
                  position: "absolute", right: -1, top: 0, bottom: 0, width: 7, cursor: "col-resize",
                  background: "linear-gradient(90deg,transparent,rgba(255,255,255,.55))", borderRadius: "0 4px 0 0",
                }}
              />
            )}
          </div>
        );
      })}
      <button
        onClick={props.onAddAtPlayhead}
        style={{
          position: "absolute", right: 0, top: -2, fontSize: 10, background: "#1f242d",
          color: "#e8ebf0", border: "1px solid #262c36", borderRadius: 6, padding: "2px 6px", cursor: "pointer",
        }}
      >{S.addAtPlayhead}</button>
    </div>
  );
}
