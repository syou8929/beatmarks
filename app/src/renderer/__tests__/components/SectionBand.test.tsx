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

function renderBand(cb: Partial<Record<"onMoveBoundary" | "onRename" | "onDelete" | "onAddAtPlayhead", ReturnType<typeof vi.fn>>> = {}) {
  const props = {
    sections: SECTIONS, viewport: VP, barIntervalSec: 2, playheadSec: 5,
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
