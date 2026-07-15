// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExportPanel } from "../../components/ExportPanel.js";

function setup() {
  const dispatch = vi.fn();
  const onExport = vi.fn().mockResolvedValue({ written: [], failed: [] });
  render(<ExportPanel fps={{ num: 30, den: 1 }} rounding="nearest"
    sources={[{ id: "mix", label: "2mix" }, { id: "ch-L", label: "L" }]} activeSourceId="mix"
    dispatch={dispatch} onExport={onExport} />);
  return { dispatch, onExport };
}

describe("ExportPanel", () => {
  it("ターゲット選択・含めるマーカー・書き出しで onExport が正しい形で呼ばれる", async () => {
    const { onExport } = setup();
    fireEvent.click(screen.getByLabelText("target json"));   // 既定OFFのjsonをON
    fireEvent.click(screen.getByLabelText("書き出し"));
    expect(onExport).toHaveBeenCalledTimes(1);
    const arg = onExport.mock.calls[0]![0];
    expect(arg.targets).toContain("json");
    expect(arg.sourceIds).toEqual(["mix"]);          // 既定はアクティブのみ
    expect(typeof arg.includeEnvelopes).toBe("boolean");
  });

  it("fps 変更で FPS_CHANGED、丸め変更で ROUNDING_CHANGED", () => {
    const { dispatch } = setup();
    fireEvent.change(screen.getByLabelText("フレームレート"), { target: { value: "25" } });
    expect(dispatch).toHaveBeenCalledWith({ type: "FPS_CHANGED", fps: { num: 25, den: 1 } });
    fireEvent.change(screen.getByLabelText("丸め"), { target: { value: "floor" } });
    expect(dispatch).toHaveBeenCalledWith({ type: "ROUNDING_CHANGED", rounding: "floor" });
  });

  it("ソース=全てで sourceIds が全ソース", async () => {
    const { onExport } = setup();
    fireEvent.click(screen.getByLabelText("全ソース"));
    fireEvent.click(screen.getByLabelText("target json"));
    fireEvent.click(screen.getByLabelText("書き出し"));
    expect(onExport.mock.calls[0]![0].sourceIds).toEqual(["mix", "ch-L"]);
  });
});
