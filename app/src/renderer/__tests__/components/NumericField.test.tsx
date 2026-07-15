// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NumericField } from "../../components/NumericField.js";

describe("NumericField", () => {
  it("クリックで入力モード→有効値は onCommit(true) で確定", () => {
    const onCommit = vi.fn().mockReturnValue(true);
    render(<NumericField value="128.00" onCommit={onCommit} ariaLabel="bpm" />);
    fireEvent.click(screen.getByLabelText("bpm"));
    const input = screen.getByLabelText("bpm") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    fireEvent.change(input, { target: { value: "140" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("140");
  });

  it("無効値(onCommit=false)は元値へ復帰し shake クラスが付く", () => {
    const onCommit = vi.fn().mockReturnValue(false);
    render(<NumericField value="128.00" onCommit={onCommit} ariaLabel="bpm" />);
    fireEvent.click(screen.getByLabelText("bpm"));
    const input = screen.getByLabelText("bpm");
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const span = screen.getByLabelText("bpm");
    expect(span.textContent).toBe("128.00");
    expect(span.className).toContain("bm-shake");
  });

  it("Esc は onCommit を呼ばずキャンセル", () => {
    const onCommit = vi.fn().mockReturnValue(true);
    render(<NumericField value="128.00" onCommit={onCommit} ariaLabel="bpm" />);
    fireEvent.click(screen.getByLabelText("bpm"));
    fireEvent.keyDown(screen.getByLabelText("bpm"), { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("bpm").textContent).toBe("128.00");
  });

  it("クリック開始時にドラフトが現在値へ同期される(前回の入力を引きずらない)", () => {
    const onCommit = vi.fn().mockReturnValue(true);
    const { rerender } = render(<NumericField value="128.00" onCommit={onCommit} ariaLabel="bpm" />);
    fireEvent.click(screen.getByLabelText("bpm"));
    fireEvent.keyDown(screen.getByLabelText("bpm"), { key: "Escape" }); // キャンセル、値は変わらない
    rerender(<NumericField value="150.00" onCommit={onCommit} ariaLabel="bpm" />);
    fireEvent.click(screen.getByLabelText("bpm"));
    const input = screen.getByLabelText("bpm") as HTMLInputElement;
    expect(input.value).toBe("150.00");
  });
});
