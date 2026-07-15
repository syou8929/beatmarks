// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HitLanes } from "../../components/HitLanes.js";
import type { Viewport } from "../../editor/waveGeom.js";
import type { HitInfo } from "../../../shared/types.js";
import { STRINGS } from "../../strings.js";

const vp: Viewport = { scrollSec: 0, samplesPerPx: 512, sampleRate: 44100, widthPx: 800 };
const hits: HitInfo[] = [
  { timeSec: 1.0, band: "low", strength: 0.9 },
  { timeSec: 2.0, band: "mid", strength: 0.8 },
];

describe("HitLanes", () => {
  it("帯域スライダー変更で EDIT_APPLIED {hitThreshold:{…,[band]:v}} を発火", () => {
    const dispatch = vi.fn();
    render(
      <HitLanes
        hits={hits}
        threshold={{ low: 0.1, mid: 0.2, high: 0.3 }}
        deletedMarkerIds={[]}
        viewport={vp}
        selectedMarkerId={null}
        dispatch={dispatch}
      />,
    );
    fireEvent.change(screen.getByLabelText(`${STRINGS.hitLane.low} ${STRINGS.hitLane.sensitivity}`), {
      target: { value: "0.7" },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "EDIT_APPLIED",
      edit: { hitThreshold: { low: 0.7, mid: 0.2, high: 0.3 } },
    });
  });

  it("ティッククリックで MARKER_SELECTED(hit-{band}-{index})", () => {
    const dispatch = vi.fn();
    render(
      <HitLanes
        hits={hits}
        threshold={{ low: 0, mid: 0, high: 0 }}
        deletedMarkerIds={[]}
        viewport={vp}
        selectedMarkerId={null}
        dispatch={dispatch}
      />,
    );
    fireEvent.click(screen.getByLabelText("hit low 0"));
    expect(dispatch).toHaveBeenCalledWith({ type: "MARKER_SELECTED", markerId: "hit-low-0" });
  });

  it("Enterキーでもティックが選択される(role=buttonのキーボード操作対応)", () => {
    const dispatch = vi.fn();
    render(
      <HitLanes
        hits={hits}
        threshold={{ low: 0, mid: 0, high: 0 }}
        deletedMarkerIds={[]}
        viewport={vp}
        selectedMarkerId={null}
        dispatch={dispatch}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("hit mid 1"), { key: "Enter" });
    expect(dispatch).toHaveBeenCalledWith({ type: "MARKER_SELECTED", markerId: "hit-mid-1" });
  });

  it("deletedMarkerIds に含まれるヒットは描画しない(削除済みは非表示、復元はT9のテーブル)", () => {
    const dispatch = vi.fn();
    render(
      <HitLanes
        hits={hits}
        threshold={{ low: 0, mid: 0, high: 0 }}
        deletedMarkerIds={["hit-low-0"]}
        viewport={vp}
        selectedMarkerId={null}
        dispatch={dispatch}
      />,
    );
    expect(screen.queryByLabelText("hit low 0")).toBeNull();
    expect(screen.getByLabelText("hit mid 1")).toBeTruthy();
  });
});
