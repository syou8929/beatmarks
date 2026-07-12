# BeatMarks App (shared library)

計画②の成果物: マーカー導出+11形式のエクスポータ(純関数、Electron 非依存)。

## 開発

    cd app
    npm install
    npm test          # vitest
    npm run typecheck # tsc --noEmit

ゴールデン更新(出力仕様を意図的に変えたときのみ):

    UPDATE_GOLDEN=1 npx vitest run src/shared/__tests__/integration-golden.test.ts

## 使い方(計画③のUIから)

    import { parseEngineResult, defaultEditState } from "./shared/validate.js";
    import { deriveMarkers } from "./shared/deriveMarkers.js";
    import { runExport } from "./shared/exporters/index.js";
    import { embedWavCues } from "./shared/exporters/wavCues.js";

    const { analysis } = parseEngineResult(engineJson);
    const markers = deriveMarkers(analysis, edits, sourceId);
    const { fileName, data } = runExport("aejsx", markers, ctx); // 文字列 or bytes
    // WAVキューのみ: embedWavCues(wavBytes, markers, ctx)

## ターゲットと略称(スペック §8)

| target | 略称 | 拡張子 | 備考 |
|---|---|---|---|
| json / csv / midi | markers | json / csv / mid | 正規形式・汎用 |
| aejsx | AE | jsx | ES3・matchName・エンベロープ焼き込み |
| premiere | PPro | xml | xmeml v4 |
| resolve | Resolve | edl | マーカーEDL(CRLF) |
| blender | Blender | py | fps/fps_base設定つき |
| wavcues | cues | wav | 元WAVにcue/adtl埋め込み |
| reaper | REAPER | csv | タブ区切り(X-Raymスクリプトで読み込み) |
| nuendo | Nuendo | csv | TC列。24/25/29.97/30fpsのみ |
| audacity | Audacity | txt | ラベルトラック |
