// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";

import { SectionBand, type SectionView } from "../../components/SectionBand.js";
import type { Viewport } from "../../editor/waveGeom.js";
import { STRINGS } from "../../strings.js";

const VP: Viewport = { scrollSec: 0, samplesPerPx: 441, sampleRate: 44100, widthPx: 1000 }; // 0.01s/px

const SECTIONS: SectionView[] = [
  { id: "sec-o0", startSec: 0, durationSec: 4, label: "イントロ", color: "#5b7fd4" },
  { id: "sec-o1", startSec: 4, durationSec: 4, label: "Aメロ", color: "#38a3a5" },
];

// sec-o0(元添字0)が deletedMarkerIds で非表示になっている想定 — 表示配列には sec-o1/sec-o2 のみが並ぶため、
// 表示位置(0,1)と元添字(1,2)がズレる。回帰テストと追加セクション(sec-a*)no-opテストで使う。
const HIDDEN_FIRST_SECTIONS: SectionView[] = [
  { id: "sec-o1", startSec: 0, durationSec: 4, label: "Aメロ", color: "#38a3a5" },
  { id: "sec-o2", startSec: 4, durationSec: 4, label: "サビ", color: "#f2a541" },
];

function renderBand(
  cb: Partial<Record<"onMoveBoundary" | "onRename" | "onDelete" | "onAddAtPlayhead", ReturnType<typeof vi.fn>>> = {},
  sections: SectionView[] = SECTIONS,
) {
  const props = {
    sections, viewport: VP, barIntervalSec: 2, playheadSec: 5,
    snap: (s: number) => s,
    onMoveBoundary: cb.onMoveBoundary ?? vi.fn(),
    onRename: cb.onRename ?? vi.fn(),
    onDelete: cb.onDelete ?? vi.fn(),
    onAddAtPlayhead: cb.onAddAtPlayhead ?? vi.fn(),
  };
  return { ...render(<SectionBand {...props} />), props };
}

describe("SectionBand", () => {
  it("ダブルクリックでインライン入力→Enterで onRename(index,label)", () => {
    const onRename = vi.fn();
    renderBand({ onRename });
    fireEvent.doubleClick(screen.getByText("Aメロ"));
    const input = screen.getByDisplayValue("Aメロ");
    fireEvent.change(input, { target: { value: "サビ" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith(1, "サビ");
  });

  it("[回帰] 先頭の元セクション(sec-o0)が非表示のとき、表示位置2番目(sec-o2)をリネームすると位置添字(1)ではなく元添字(2)で onRename が呼ばれる", () => {
    // 表示配列: [sec-o1(表示位置0・元添字1), sec-o2(表示位置1・元添字2)]。
    // 修正前は map ループの位置添字をそのまま渡していたため、実際にダブルクリックした sec-o2 ではなく
    // 元添字1のセクション(sec-o1)を誤ってリネームしてしまっていた(SECTION_EDIT_ADDED は元添字契約)。
    const onRename = vi.fn();
    renderBand({ onRename }, HIDDEN_FIRST_SECTIONS);
    fireEvent.doubleClick(screen.getByText("サビ")); // 表示位置2番目 = sec-o2(元添字2)
    const input = screen.getByDisplayValue("サビ");
    fireEvent.change(input, { target: { value: "リフレイン" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith(2, "リフレイン");
    expect(onRename).not.toHaveBeenCalledWith(1, expect.anything());
  });

  it("追加セクション(sec-a*)はダブルクリックしても編集モードに入らない(境界移動と同じPhase2制約)", () => {
    const onRename = vi.fn();
    const sections: SectionView[] = [
      ...HIDDEN_FIRST_SECTIONS,
      { id: "sec-a0", startSec: 8, durationSec: 2, label: "追加区間", color: "#999999" },
    ];
    renderBand({ onRename }, sections);
    fireEvent.doubleClick(screen.getByText("追加区間"));
    expect(screen.queryByDisplayValue("追加区間")).toBeNull(); // 入力欄が出ていない = 編集モードに入っていない
    expect(onRename).not.toHaveBeenCalled();
  });

  it("空ラベル(空白のみ含む)で確定しても onRename は呼ばれない", () => {
    const onRename = vi.fn();
    renderBand({ onRename });
    fireEvent.doubleClick(screen.getByText("Aメロ"));
    const input = screen.getByDisplayValue("Aメロ");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("   ")).toBeNull(); // 編集モードは終了している(確定失敗でも入力欄は閉じる)
    expect(screen.getByText("Aメロ")).toBeTruthy(); // 表示ラベルは変更されず元のまま
  });

  it("削除ボタンで onDelete(sec-id)", () => {
    const onDelete = vi.fn();
    renderBand({ onDelete });
    // 各セクションの削除ボタン(title=削除)。2つ目(Aメロ)を押す
    const dels = screen.getAllByTitle(STRINGS.section.delete);
    fireEvent.click(dels[1]!);
    expect(onDelete).toHaveBeenCalledWith("sec-o1");
  });

  it("再生位置に境界追加ボタンで onAddAtPlayhead", () => {
    const onAddAtPlayhead = vi.fn();
    renderBand({ onAddAtPlayhead });
    fireEvent.click(screen.getByText(STRINGS.section.addAtPlayhead));
    expect(onAddAtPlayhead).toHaveBeenCalled();
  });

  it("境界ハンドルのドラッグで onMoveBoundary(次セクション添字, sec) が px→sec→snap→clamp を経て呼ばれる", () => {
    // sectionGeom の resolveBoundaryDrag を SectionBand が実際に配線できていることの結合確認
    // (sectionGeom.test.ts は数式のみを検証しており、DOM 経由の配線はここでしか通らない)。
    const onMoveBoundary = vi.fn();
    const { container } = renderBand({ onMoveBoundary });
    // セクション0(イントロ)の div の最後の子要素 = 右端ドラッグハンドル
    // (通常時の子順: ラベルspan, 削除button, ハンドルspan)。
    const firstSectionDiv = container.querySelectorAll("[data-sectionband] > div")[0]!;
    const handle = firstSectionDiv.lastElementChild as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 0 });
    // 実際の移動は window 上の pointermove で処理される(SectionBand.handleDrag の実装)。
    fireEvent.pointerMove(window, { clientX: 300 }); // 300px * 0.01s/px = 3.0s、snap恒等、[0.1,7.9]内
    expect(onMoveBoundary).toHaveBeenCalledWith(1, 3);
    onMoveBoundary.mockClear();
    fireEvent.pointerUp(window, { clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 900 });
    expect(onMoveBoundary).not.toHaveBeenCalled(); // pointerup後はリスナー解除済み
  });
});
