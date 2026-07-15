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

  // T12必須指示(台帳・レビューImportant #1「書き出しの静黙全滅チェーンを閉じる」): onExport が
  // reject しても(exportFlowの防御が効かない予期しない経路も含め)、無音で終わらずエラーが
  // 結果UIに表示されることを確認する。
  it("[回帰] onExport が reject してもエラーが結果表示に出る(静黙失敗しない)", async () => {
    const dispatch = vi.fn();
    const onExport = vi.fn().mockRejectedValue(new Error("IPC切断"));
    render(<ExportPanel fps={{ num: 30, den: 1 }} rounding="nearest"
      sources={[{ id: "mix", label: "2mix" }]} activeSourceId="mix"
      dispatch={dispatch} onExport={onExport} />);
    fireEvent.click(screen.getByLabelText("target json"));
    fireEvent.click(screen.getByLabelText("書き出し"));
    expect(await screen.findByText(/IPC切断/)).toBeTruthy();
    // busyが解除され、リトライ相当の再実行も可能な状態に戻っていること
    expect((screen.getByLabelText("書き出し") as HTMLButtonElement).disabled).toBe(false);
  });
});
