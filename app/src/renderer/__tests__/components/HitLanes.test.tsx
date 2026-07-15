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
  it("帯域スライダーのドラッグ確定(pointerup)で EDIT_APPLIED {hitThreshold:{…,[band]:v}} を発火", () => {
    const dispatch = vi.fn();
    render(
      <HitLanes
        hits={hits}
        threshold={{ low: 0.1, mid: 0.2, high: 0.3 }}
        deletedMarkerIds={[]}
        viewport={vp}
        activeSourceId="mix"
        selectedMarker={null}
        dispatch={dispatch}
      />,
    );
    const slider = screen.getByLabelText(`${STRINGS.hitLane.low} ${STRINGS.hitLane.sensitivity}`);
    fireEvent.change(slider, { target: { value: "0.7" } });
    // ドラッグ中(onChange直後)はまだ dispatch しない(T7 judgment call: undo スタック保護)。
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(dispatch).toHaveBeenCalledWith({
      type: "EDIT_APPLIED",
      edit: { hitThreshold: { low: 0.7, mid: 0.2, high: 0.3 } },
    });
  });

  it("値が変化していないときは pointerup/blur で dispatch しない(空undoエントリ防止)", () => {
    const dispatch = vi.fn();
    render(
      <HitLanes
        hits={hits}
        threshold={{ low: 0.1, mid: 0.2, high: 0.3 }}
        deletedMarkerIds={[]}
        viewport={vp}
        activeSourceId="mix"
        selectedMarker={null}
        dispatch={dispatch}
      />,
    );
    const slider = screen.getByLabelText(`${STRINGS.hitLane.low} ${STRINGS.hitLane.sensitivity}`);
    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("ティッククリックで MARKER_SELECTED(activeSourceId・hit-{band}-{index}の複合キー)", () => {
    const dispatch = vi.fn();
    render(
      <HitLanes
        hits={hits}
        threshold={{ low: 0, mid: 0, high: 0 }}
        deletedMarkerIds={[]}
        viewport={vp}
        activeSourceId="mix"
        selectedMarker={null}
        dispatch={dispatch}
      />,
    );
    fireEvent.click(screen.getByLabelText("hit low 0"));
    expect(dispatch).toHaveBeenCalledWith({
      type: "MARKER_SELECTED",
      selection: { sourceId: "mix", markerId: "hit-low-0" },
    });
  });

  it("Enterキーでもティックが選択される(role=buttonのキーボード操作対応)", () => {
    const dispatch = vi.fn();
    render(
      <HitLanes
        hits={hits}
        threshold={{ low: 0, mid: 0, high: 0 }}
        deletedMarkerIds={[]}
        viewport={vp}
        activeSourceId="mix"
        selectedMarker={null}
        dispatch={dispatch}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("hit mid 1"), { key: "Enter" });
    expect(dispatch).toHaveBeenCalledWith({
      type: "MARKER_SELECTED",
      selection: { sourceId: "mix", markerId: "hit-mid-1" },
    });
  });

  it("deletedMarkerIds に含まれるヒットは描画しない(削除済みは非表示、復元はT9のテーブル)", () => {
    const dispatch = vi.fn();
    render(
      <HitLanes
        hits={hits}
        threshold={{ low: 0, mid: 0, high: 0 }}
        deletedMarkerIds={["hit-low-0"]}
        viewport={vp}
        activeSourceId="mix"
        selectedMarker={null}
        dispatch={dispatch}
      />,
    );
    expect(screen.queryByLabelText("hit low 0")).toBeNull();
    expect(screen.getByLabelText("hit mid 1")).toBeTruthy();
  });

  // T12必須指示(台帳・レビューImportant): selectedMarkerId がソース非限定だと、非アクティブ
  // ソースが選んだ id とたまたま一致するこのレーンのティックまで幻ハイライトしてしまう。
  describe("[回帰] 幻ハイライト(selectedMarker のソース限定)", () => {
    it("選択が別ソース由来なら同じ id のティックでもハイライトしない", () => {
      const dispatch = vi.fn();
      render(
        <HitLanes
          hits={hits}
          threshold={{ low: 0, mid: 0, high: 0 }}
          deletedMarkerIds={[]}
          viewport={vp}
          activeSourceId="mix"
          selectedMarker={{ sourceId: "ch-L", markerId: "hit-low-0" }} // 別ソースが同id を選択中
          dispatch={dispatch}
        />,
      );
      const tick = screen.getByLabelText("hit low 0");
      expect(tick.style.outline).toBeFalsy();
    });

    it("選択がこのレーンのソース由来なら同じ id のティックをハイライトする", () => {
      const dispatch = vi.fn();
      render(
        <HitLanes
          hits={hits}
          threshold={{ low: 0, mid: 0, high: 0 }}
          deletedMarkerIds={[]}
          viewport={vp}
          activeSourceId="mix"
          selectedMarker={{ sourceId: "mix", markerId: "hit-low-0" }}
          dispatch={dispatch}
        />,
      );
      const tick = screen.getByLabelText("hit low 0");
      expect(tick.style.outline).toBeTruthy();
    });
  });
});
