// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";

import { Overview } from "../../components/Overview.js";
import type { Viewport } from "../../editor/waveGeom.js";
import { STRINGS } from "../../strings.js";

// WaveCanvas.test.tsx の recordingCtx() と同じ理由: Overview.draw() は dpr スケールのため
// ctx.setTransform を無条件に呼ぶので、フェイクにも必ず含める(欠けていると
// "ctx.setTransform is not a function" でマウント時に例外になる)。
function fakeCtx() {
  return {
    clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(), setTransform: vi.fn(),
    strokeStyle: "", fillStyle: "", lineWidth: 1, globalAlpha: 1,
  };
}

function stubCanvasContext(): { getContext: ReturnType<typeof vi.fn>; restore: () => void } {
  const getContext = vi.fn(() => fakeCtx());
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = getContext as unknown as typeof orig;
  return { getContext, restore: () => { HTMLCanvasElement.prototype.getContext = orig; } };
}

const VP: Viewport = { scrollSec: 0, samplesPerPx: 441, sampleRate: 44100, widthPx: 1000 };

describe("Overview マウント", () => {
  it("canvas を描画し 2D コンテキストを取得する", () => {
    const { getContext, restore } = stubCanvasContext();
    try {
      const { container } = render(
        <Overview
          peaks={null} sections={[]} durationSec={210} viewport={VP}
          playheadSec={0} onScrubTo={vi.fn()}
        />,
      );
      expect(container.querySelector("canvas")).not.toBeNull();
      expect(getContext).toHaveBeenCalled();
    } finally { restore(); }
  });

  it("strings.ts の overview.hint を title に表示する(コンポーネントローカルな文言を持たない)", () => {
    const { restore } = stubCanvasContext();
    try {
      const { container } = render(
        <Overview
          peaks={null} sections={[]} durationSec={210} viewport={VP}
          playheadSec={0} onScrubTo={vi.fn()}
        />,
      );
      expect(container.querySelector("canvas")?.getAttribute("title")).toBe(STRINGS.overview.hint);
    } finally { restore(); }
  });
});

describe("Overview: クリック/ドラッグで onScrubTo(sec)(表示窓ドラッグ+クリックジャンプ)", () => {
  function setup() {
    const { restore } = stubCanvasContext();
    const onScrubTo = vi.fn();
    const { container } = render(
      <Overview
        peaks={null} sections={[]} durationSec={200} viewport={VP}
        playheadSec={0} onScrubTo={onScrubTo}
      />,
    );
    const canvas = container.querySelector("canvas")!;
    // jsdom の getBoundingClientRect は既定で全0を返すため、px→sec 変換を意味あるものにするため明示的にスタブする。
    canvas.getBoundingClientRect = (): DOMRect => ({
      width: 1000, height: 44, top: 0, left: 0, right: 1000, bottom: 44, x: 0, y: 0,
      toJSON() { return {}; },
    });
    return { canvas, onScrubTo, restore };
  }

  it("クリック(pointerdown単発)で一度だけ onScrubTo(sec) が呼ばれる", () => {
    const { canvas, onScrubTo, restore } = setup();
    try {
      fireEvent.pointerDown(canvas, { clientX: 500 });
      expect(onScrubTo).toHaveBeenCalledTimes(1);
      expect(onScrubTo).toHaveBeenCalledWith(100); // 500/1000*200
    } finally { restore(); }
  });

  it("ドラッグ(pointerdown→windowのpointermove)で継続的に onScrubTo が呼ばれる", () => {
    const { canvas, onScrubTo, restore } = setup();
    try {
      fireEvent.pointerDown(canvas, { clientX: 250 });
      expect(onScrubTo).toHaveBeenNthCalledWith(1, 50); // 250/1000*200
      fireEvent.pointerMove(window, { clientX: 750 });
      expect(onScrubTo).toHaveBeenNthCalledWith(2, 150); // 750/1000*200
      expect(onScrubTo).toHaveBeenCalledTimes(2);
    } finally { restore(); }
  });

  it("pointerupでドラッグ追跡を終了する(以後のwindow pointermoveは呼ばれない)", () => {
    const { canvas, onScrubTo, restore } = setup();
    try {
      fireEvent.pointerDown(canvas, { clientX: 250 });
      fireEvent.pointerUp(window, { clientX: 250 });
      onScrubTo.mockClear();
      fireEvent.pointerMove(window, { clientX: 900 });
      expect(onScrubTo).not.toHaveBeenCalled();
    } finally { restore(); }
  });
});
