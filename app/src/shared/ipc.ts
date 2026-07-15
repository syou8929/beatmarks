/** main ↔ renderer の IPC 契約。チャンネル名と型をここに集約する。
 *  (shared 純度テストの除外対象 — 型のみで実行時依存はない) */
import type { AnalysisResult, AudioSource, EditState, Fps, MarkerType, RoundingMode } from "./types.js";
import type { TargetKey } from "./naming.js";

export const IPC_CHANNELS = {
  probeMedia: "bm:probeMedia",
  analyzeMedia: "bm:analyzeMedia",
  cancelAnalyze: "bm:cancelAnalyze",
  readFileBytes: "bm:readFileBytes",
  saveProject: "bm:saveProject",
  openProject: "bm:openProject",
  writeExports: "bm:writeExports",
  chooseExportDir: "bm:chooseExportDir",
} as const;

export const IPC_EVENTS = {
  analyzeProgress: "bm:analyze:progress",
} as const;

export interface ProbeTrack {
  index: number;          // ffprobe の audio ストリーム順(0起点)
  codec: string;
  channels: number;
  language: string | null;
  title: string | null;
}

export interface ProbeResult {
  durationSec: number;
  tracks: ProbeTrack[];
}

/** 入力設定(スペック §3.1)。単一トラックの既定は mode:"mix" + trackIndexes:[0] */
export interface InputConfig {
  mode: "mix" | "multitrack";     // mix=選択トラックを1ソースに統合 / multitrack=トラックごとにソース化
  trackIndexes: number[];          // 解析対象トラック
  channelSplit: "mono" | "stereo-split"; // mono=モノ統合 / stereo-split=L・R個別ソース
}

export interface AnalyzeRequest {
  filePath: string;
  input: InputConfig;
}

export interface AnalyzedSource {
  source: AudioSource;
  analysis: AnalysisResult;
  warnings: string[];
  analysisWavPath: string;   // 22.05k mono(デバッグ用)
}

export interface AnalyzedProject {
  mediaPath: string;
  mediaHash: string;         // 再生用wavのsha256
  baseName: string;
  playbackWavPath: string;   // 44.1k stereo
  durationSec: number;
  sources: AnalyzedSource[];
}

/** analyzeMedia の戻り。キャンセルは IPC 越えでも判別できるセンチネルにする
 *  (renderer 側でエラー同一性/メッセージ照合をしないための境界変換)。 */
export type AnalyzeOutcome =
  | { cancelled: false; project: AnalyzedProject }
  | { cancelled: true };

export interface AnalyzeProgressEvent {
  sourceLabel: string;
  sourceIndex: number;
  sourceCount: number;
  stage: string;             // extract | load | tempo | ... | done(engine準拠+extract)
  percent: number;           // ソース内 0-100
}

/** .bmk の中身(スペック §6 ProjectFile。ui は renderer 都合の最小限) */
export interface ProjectFileState {
  version: 1;
  mediaPath: string;
  mediaHash: string;
  baseName: string;
  playbackWavPath: string;
  durationSec: number;
  sources: { source: AudioSource; analysis: AnalysisResult; edits: EditState }[];
  activeSourceId: string;
  ui: { fps: Fps; rounding: "nearest" | "floor" };
}

export interface ExportRequest {
  targets: TargetKey[];
  sourceIds: string[];
  fps: Fps;
  rounding: RoundingMode;
  include: MarkerType[];
  includeEnvelopes: boolean;   // 契約差分#9
  destDir: string;
  projectState: ProjectFileState;
}

export interface WriteExportsResult {
  written: string[];
  failed: { path: string; message: string }[];
}

export interface IpcApi {
  probeMedia(filePath: string): Promise<ProbeResult>;
  analyzeMedia(req: AnalyzeRequest): Promise<AnalyzeOutcome>;
  cancelAnalyze(): Promise<void>;
  readFileBytes(path: string): Promise<ArrayBuffer>;
  saveProject(state: ProjectFileState, toPath: string | null): Promise<string>;
  openProject(): Promise<{ path: string; state: ProjectFileState } | null>;
  writeExports(req: ExportRequest): Promise<WriteExportsResult>;
  chooseExportDir(): Promise<string | null>;
  getPathForFile(file: File): string;
}
