/** writeExports 本実装(スペック §8)。ソース×ターゲットで ExportContext を組み立て、
 *  共有エクスポータ(計画②)を呼んで実ファイルを書く。fs/ffmpeg は deps 注入(テスト容易)。 */
import { basename, join } from "node:path";

import { deriveMarkers } from "../shared/deriveMarkers.js";
import { embedWavCues } from "../shared/exporters/wavCues.js";
import { runExport } from "../shared/exporters/index.js";
import type { ExportRequest, ProjectFileState, WriteExportsResult } from "../shared/ipc.js";
import { buildFileName, type TargetKey } from "../shared/naming.js";
import { timeSigDenominatorFor, type ExportContext, type TempoPoint } from "../shared/types.js";

export interface ExportWriterDeps {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  /** 動画等の非WAV入力に対し、cue埋め込み用のフルWAVを destPath に抽出する。trackIndexes は
   *  ProjectFileState.input.trackIndexes(台帳追加要件で永続化)をそのまま渡す — 以前は
   *  呼び出し側([0]固定)がトラック選択を無視していた。 */
  extractWavForCues(mediaPath: string, trackIndexes: number[], destPath: string): Promise<void>;
  tmpWavPath(): string;
}

type SourceEntry = ProjectFileState["sources"][number];

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

function buildExportContext(req: ExportRequest, s: SourceEntry, multiSource: boolean): ExportContext {
  const { analysis, edits } = s;
  const override =
    edits.bpmOverride !== undefined && Number.isFinite(edits.bpmOverride) && edits.bpmOverride > 0
      ? edits.bpmOverride : undefined;
  const bpmLabel =
    override !== undefined ? override.toFixed(2)
      : analysis.tempoMode === "fixed" && analysis.bpm != null ? analysis.bpm.toFixed(2) : "可変";
  const tempoMap: TempoPoint[] = override !== undefined ? [{ timeSec: 0, bpm: override }] : analysis.tempoMap;
  return {
    fps: req.fps, rounding: req.rounding, include: req.include,
    baseName: req.projectState.baseName,
    sourceLabel: multiSource ? s.source.label : null,
    audioFileName: basename(req.projectState.mediaPath),
    audioDurationSec: req.projectState.durationSec,
    bpmLabel,
    keyLabel: `${analysis.key.global.name} (${analysis.key.global.camelot})`,
    beatsPerBar: edits.beatsPerBar,
    timeSigDenominator: timeSigDenominatorFor(edits.beatsPerBar), // 必須(台帳: ハードコード4禁止)
    tempoMap,
    envelopes: req.includeEnvelopes ? analysis.envelopes : null,
  };
}

/** cue埋め込み用のWAVバイト列。.wav 入力は原品質のコピー、それ以外は ffmpeg 抽出(§8)。 */
async function loadCueWav(mediaPath: string, trackIndexes: number[], deps: ExportWriterDeps): Promise<Uint8Array> {
  if (mediaPath.toLowerCase().endsWith(".wav")) return deps.readFile(mediaPath);
  const tmp = deps.tmpWavPath();
  await deps.extractWavForCues(mediaPath, trackIndexes, tmp);
  return deps.readFile(tmp);
}

/** naming.ts に dedup が無いため、バッチ内でのファイル名衝突をここで解消する。 */
function dedupe(name: string, used: Set<string>): string {
  if (!used.has(name)) { used.add(name); return name; }
  const dot = name.lastIndexOf(".");
  const stem = dot >= 0 ? name.slice(0, dot) : name;
  const ext = dot >= 0 ? name.slice(dot) : "";
  let i = 2;
  let cand = `${stem}-${i}${ext}`;
  while (used.has(cand)) cand = `${stem}-${++i}${ext}`;
  used.add(cand);
  return cand;
}

export async function writeExports(req: ExportRequest, deps: ExportWriterDeps): Promise<WriteExportsResult> {
  const written: string[] = [];
  const failed: { path: string; message: string }[] = [];
  const used = new Set<string>();

  const sources = req.projectState.sources.filter((s) => req.sourceIds.includes(s.source.id));
  const multiSource = sources.length > 1;

  for (const s of sources) {
    const ctx = buildExportContext(req, s, multiSource);
    const markers = deriveMarkers(s.analysis, s.edits, s.source.id);
    let cueWav: Promise<Uint8Array> | null = null;

    for (const target of req.targets) {
      let fileName: string;
      let data: string | Uint8Array;
      try {
        if (target === "wavcues") {
          if (!cueWav) cueWav = loadCueWav(req.projectState.mediaPath, req.projectState.input.trackIndexes, deps);
          const wavBytes = await cueWav;
          fileName = buildFileName(ctx.baseName, ctx.sourceLabel, "wavcues");
          data = embedWavCues(wavBytes, markers, ctx);
        } else {
          const r = runExport(target as TargetKey, markers, ctx);
          fileName = r.fileName;
          data = r.data;
        }
      } catch (e) {
        failed.push({ path: buildFileName(ctx.baseName, ctx.sourceLabel, target as TargetKey), message: msg(e) });
        continue;
      }
      const full = join(req.destDir, dedupe(fileName, used));
      try {
        await deps.writeFile(full, data);
        written.push(full);
      } catch (e) {
        failed.push({ path: full, message: msg(e) });
      }
    }
  }
  return { written, failed };
}
