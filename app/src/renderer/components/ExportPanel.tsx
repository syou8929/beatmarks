/** 書き出しパネル(モック .export 準拠、スペック §7/§8/§9)。ターゲット/含めるマーカー/
 *  fps/丸め/ソースを選び onExport に払い出す。結果表示と失敗リトライを内包。 */
import React, { useState } from "react";

import type { WriteExportsResult } from "../../shared/ipc.js";
import type { Fps, MarkerType, RoundingMode } from "../../shared/types.js";
import { TARGETS, type TargetKey } from "../../shared/naming.js";
import { FPS_PRESETS, fpsLabel } from "../../shared/timebase.js";
import type { Action } from "../state/store.js";
import type { ExportOpts } from "../state/exportFlow.js";
import { STRINGS } from "../strings.js";

const S = STRINGS.exportPanel;

const ACTIVE_TARGETS: TargetKey[] = [
  "aejsx", "premiere", "resolve", "blender", "json", "csv", "midi", "wavcues", "reaper", "nuendo", "audacity",
];
const PHASE2 = ["C4D", "Houdini", "Maya / Max", "Unity", "Unreal"];
const INCLUDE_TYPES: MarkerType[] = ["section", "bar", "beat", "hit", "silence", "custom"];
const TYPE_LABEL: Record<MarkerType, string> = {
  section: S.incSection, bar: S.incBar, beat: S.incBeat, hit: S.incHit, silence: S.incSilence, custom: S.incCustom,
};
const CUSTOM = S.customFps;

interface ExportPanelProps {
  fps: Fps;
  rounding: RoundingMode;
  sources: { id: string; label: string }[];
  activeSourceId: string;
  dispatch: (a: Action) => void;
  onExport: (opts: ExportOpts) => Promise<WriteExportsResult | null>;
}

export function ExportPanel(props: ExportPanelProps): React.JSX.Element {
  const { fps, rounding, sources, activeSourceId, dispatch, onExport } = props;
  const [targets, setTargets] = useState<Set<TargetKey>>(new Set(["aejsx", "resolve"]));
  const [include, setInclude] = useState<Set<MarkerType>>(new Set(["section", "bar", "hit", "custom"]));
  const [envelopes, setEnvelopes] = useState(true);
  const [allSources, setAllSources] = useState(false);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WriteExportsResult | null>(null);

  const fpsKey = custom ? CUSTOM : fpsLabel(fps);
  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); return n;
  };

  function onFpsSelect(v: string): void {
    if (v === CUSTOM) { setCustom(true); return; }
    setCustom(false);
    const preset = FPS_PRESETS[v];
    if (preset) dispatch({ type: "FPS_CHANGED", fps: preset });
  }
  function onCustomFps(num: number, den: number): void {
    if (Number.isInteger(num) && Number.isInteger(den) && num > 0 && den > 0) {
      dispatch({ type: "FPS_CHANGED", fps: { num, den } });
    }
  }

  const currentOpts = (): ExportOpts => ({
    targets: [...targets], includeEnvelopes: envelopes, include: [...include],
    sourceIds: allSources ? sources.map((s) => s.id) : [activeSourceId],
  });

  async function doExport(): Promise<void> {
    if (targets.size === 0) return;
    setBusy(true);
    try { setResult(await onExport(currentOpts())); }
    finally { setBusy(false); }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.title}>{S.title}</div>
      <div style={styles.body}>
        <div style={styles.row}>
          <label style={styles.label}>{S.fps}</label>
          <select aria-label={S.fps} value={fpsKey} style={styles.select} onChange={(e) => onFpsSelect(e.target.value)}>
            {Object.keys(FPS_PRESETS).map((k) => <option key={k} value={k}>{k}</option>)}
            <option value={CUSTOM}>{CUSTOM}</option>
          </select>
          {custom && (
            <span>
              <input aria-label={S.customFpsNumAria} type="number" defaultValue={fps.num} style={styles.num}
                onChange={(e) => onCustomFps(Number(e.target.value), fps.den)} /> /
              <input aria-label={S.customFpsDenAria} type="number" defaultValue={fps.den} style={styles.num}
                onChange={(e) => onCustomFps(fps.num, Number(e.target.value))} />
            </span>
          )}
          <label style={styles.label}>{S.rounding}</label>
          <select aria-label={S.rounding} value={rounding} style={styles.select}
            onChange={(e) => dispatch({ type: "ROUNDING_CHANGED", rounding: e.target.value as RoundingMode })}>
            <option value="nearest">{S.roundNearest}</option>
            <option value="floor">{S.roundFloor}</option>
          </select>
        </div>

        <div style={styles.row}>
          <label style={{ width: "100%" }}>{S.includeLabel}</label>
          <div style={styles.checks}>
            {INCLUDE_TYPES.map((t) => (
              <label key={t} style={styles.check}>
                <input type="checkbox" checked={include.has(t)} onChange={() => setInclude((s) => toggle(s, t))} />{TYPE_LABEL[t]}
              </label>
            ))}
            <label style={styles.check}>
              <input type="checkbox" checked={envelopes} onChange={(e) => setEnvelopes(e.target.checked)} />{S.incEnvelope}
            </label>
          </div>
        </div>

        <div style={styles.row}>
          <label style={{ width: "100%" }}>{S.sourcesLabel}</label>
          <label style={styles.check}>
            <input aria-label={S.activeSourceAria} type="radio" checked={!allSources} onChange={() => setAllSources(false)} />{S.activeSourceLabel}
          </label>
          <label style={styles.check}>
            <input aria-label={S.allSourcesAria} type="radio" checked={allSources} onChange={() => setAllSources(true)} />{S.allSourcesTemplate(sources.length)}
          </label>
        </div>

        <div style={styles.row}><label style={{ width: "100%" }}>{S.targetsLabel}</label></div>
        <div style={styles.targets}>
          {ACTIVE_TARGETS.map((k) => (
            <div key={k} role="button" aria-label={`target ${k}`}
              onClick={() => setTargets((s) => toggle(s, k))}
              style={targets.has(k) ? styles.targetOn : styles.target}>
              <b>{TARGETS[k].label}</b><small style={styles.small}>{TARGETS[k].abbr}.{TARGETS[k].ext}</small>
            </div>
          ))}
          {PHASE2.map((name) => (
            <div key={name} style={styles.targetP2}><b>{name}</b><small style={styles.small}>{S.phase2Badge}</small></div>
          ))}
        </div>

        {result && (
          <div style={styles.result}>
            <div style={{ color: "#7ddc9a" }}>{S.doneTemplate(result.written.length)}</div>
            {result.failed.length > 0 && (
              <div style={{ color: "#ff4d6b" }}>
                {S.failedTemplate(result.failed.length)}
                {result.failed.map((f) => <div key={f.path} style={styles.small}>{f.path}: {f.message}</div>)}
                <button onClick={() => void doExport()}>{S.retry}</button>
              </div>
            )}
          </div>
        )}
      </div>
      <div style={styles.foot}>
        <button aria-label={S.title} disabled={busy || targets.size === 0} style={styles.primary}
          title={targets.size === 0 ? S.noTarget : undefined} onClick={() => void doExport()}>
          {busy ? S.busy : S.runTemplate(targets.size)}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { flex: "none", width: 330, display: "flex", flexDirection: "column" },
  title: { flex: "none", padding: "8px 12px", fontWeight: 700, fontSize: 12, borderBottom: "1px solid #262c36" },
  body: { flex: 1, overflow: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  label: { color: "#8b94a3", fontSize: 11 },
  select: { background: "#1f242d", color: "#e8ebf0", border: "1px solid #262c36", borderRadius: 6, padding: "4px 6px", fontSize: 11 },
  num: { width: 52, background: "#1f242d", color: "#e8ebf0", border: "1px solid #262c36", borderRadius: 6, padding: "2px 4px" },
  checks: { display: "flex", gap: 10, flexWrap: "wrap" },
  check: { display: "flex", gap: 4, alignItems: "center", fontSize: 11, cursor: "pointer" },
  targets: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 },
  target: { border: "1px solid #262c36", background: "#191d24", borderRadius: 8, padding: "7px 4px", textAlign: "center", cursor: "pointer" },
  targetOn: { border: "1px solid #ff4d6b", background: "#241a20", borderRadius: 8, padding: "7px 4px", textAlign: "center", cursor: "pointer" },
  targetP2: { border: "1px solid #262c36", background: "#191d24", borderRadius: 8, padding: "7px 4px", textAlign: "center", opacity: 0.42 },
  small: { display: "block", color: "#5a6272", fontSize: 9 },
  result: { fontSize: 11, borderTop: "1px solid #262c36", paddingTop: 8 },
  foot: { flex: "none", padding: "10px 12px", borderTop: "1px solid #262c36" },
  primary: { width: "100%", padding: 9, fontSize: 13, background: "#ff4d6b", border: "1px solid #ff4d6b", color: "#fff", fontWeight: 700, borderRadius: 6, cursor: "pointer" },
};
