// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import React from "react";

function Probe(props: { label: string }): React.JSX.Element {
  return <div role="status">{props.label}</div>;
}

describe("jsdom + RTL パイプライン", () => {
  it("コンポーネントを描画してテキストを取得できる", () => {
    render(<Probe label="ok" />);
    expect(screen.getByRole("status").textContent).toBe("ok");
  });
});
