/** スペック §6 データモデルの TypeScript 定義。時刻は常に秒 (float)。 */

export interface Fps {
  num: number; // 例 29.97 = {num: 30000, den: 1001}
  den: number;
}

/** 解析ソース(スペック §3.1/§6)。マルチトラック・チャンネル分割の単位。 */
export interface AudioSource {
  id: string;                          // プロジェクト内で一意(例 "mix", "track-0", "ch-L")
  kind: "mix" | "track" | "channel";   // モノ/2mix統合・トラック・チャンネル(L/R等)
  label: string;                       // 表示名(例 "2mix", "Vo", "L")
}

export type RoundingMode = "nearest" | "floor";

export type MarkerType = "beat" | "bar" | "section" | "hit" | "silence" | "custom";
export type Band = "low" | "mid" | "high";

export interface Marker {
  id: string;
  sourceId: string;
  timeSec: number;
  type: MarkerType;
  label: string;
  color: string; // "#rrggbb"
  source: "auto" | "user";
  meta?: {
    strength?: number;
    band?: Band;
    durationSec?: number; // section / silence はリージョン
    barNumber?: number;   // bar マーカー
  };
}

export interface KeyGuess {
  name: string;
  camelot: string;
  confidence: number;
}

export interface TempoPoint {
  timeSec: number;
  bpm: number;
}

export interface SectionInfo {
  startSec: number;
  endSec: number;
  label: string;
  clusterId: number;
  chorusCandidate: boolean;
}

export interface HitInfo {
  timeSec: number;
  band: Band;
  strength: number;
}

export interface SilenceInfo {
  startSec: number;
  endSec: number;
  floorDb: number;
}

export interface Envelopes {
  sampleRateHz: number; // エンジンは 100
  total: number[];
  low: number[];
  mid: number[];
  high: number[];
}

export interface AnalysisResult {
  durationSec: number;
  tempoMode: "fixed" | "variable";
  bpm: number | null;
  gridOffsetSec: number;
  beats: number[];
  downbeatPhase: 0 | 1 | 2 | 3;
  tempoMap: TempoPoint[];
  key: { global: KeyGuess; perSection: KeyGuess[] };
  sections: SectionInfo[];
  hits: HitInfo[];
  silences: SilenceInfo[];
  envelopes: Envelopes;
}

export interface EngineResult {
  analysis: AnalysisResult;
  warnings: string[];
}

/** セクション編集操作。
 *  index の規則(重要): move/rename/recolor/delete の index は「元の
 *  analysis.sections の添字」を指す。add で増えた分は
 *  index = 元の sections の長さ + 追加順(0起点) で参照する。
 *  適用順序やソートで添字が変わっても、常にこの「元添字」で指す。 */
export type SectionEdit =
  | { op: "move"; index: number; startSec: number }
  | { op: "rename"; index: number; label: string }
  | { op: "recolor"; index: number; color: string }
  | { op: "add"; startSec: number; label: string; color: string }
  | { op: "delete"; index: number };

export interface EditState {
  gridOffsetDeltaSec: number;
  bpmOverride?: number;        // タップテンポ / 半分 / 2倍(固定グリッドを再生成)
  beatsPerBar: number;         // 4/4=4, 3/4=3, 6/8=6
  downbeatShift: number;       // 1拍目ずらし(整数、正=後ろへ)
  gridAnchor?: { timeSec: number; freeBefore: boolean }; // 小節1アンカー(§3.3)
  sectionEdits: SectionEdit[];
  hitThreshold: { low: number; mid: number; high: number }; // 0〜1、これ未満を除外
  silenceThreshold: { db: number; minDurSec: number };
  customMarkers: Marker[];
  deletedMarkerIds: string[];
}

/** エクスポート 1 回分の設定(UI が組み立てて渡す) */
export interface ExportContext {
  fps: Fps;
  rounding: RoundingMode;
  include: MarkerType[];       // 書き出すマーカー種別
  baseName: string;            // 元ファイル名(拡張子抜き)
  sourceLabel: string | null;  // マルチソース時のソース名(単一なら null)
  audioFileName: string;       // AE/Blender が参照する音声ファイル名(例 "track.wav")
  audioDurationSec: number;
  bpmLabel: string;            // 表示用 "128.00" / "可変"
  keyLabel: string;            // 表示用 "E minor (9A)"
  beatsPerBar: number;         // MIDI拍子イベント用(edits.beatsPerBar と同値を渡す)
  tempoMap: TempoPoint[];      // MIDIテンポトラック用(bpmOverride時はUIが1点に差し替え)
  envelopes: Envelopes | null; // AEエンベロープ焼き込み用(書き出さないときは null)
}
