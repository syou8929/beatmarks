import { describe, expect, it } from "vitest";

import { initialViewState, viewReducer, type ViewState } from "../state/viewStore.js";

describe("viewReducer", () => {
  it("SET_VIEW は指定フィールドのみ更新", () => {
    const s = viewReducer(initialViewState(), { type: "SET_VIEW", scrollSec: 12 });
    expect(s.scrollSec).toBe(12);
    expect(s.zoomSamplesPerPx).toBe(initialViewState().zoomSamplesPerPx);
  });

  it("CYCLE_TIME_UNIT は sec→frame→tc→barBeat→sec と巡回", () => {
    let s: ViewState = { ...initialViewState(), timeUnit: "sec" };
    const seq = [] as string[];
    for (let i = 0; i < 5; i++) { s = viewReducer(s, { type: "CYCLE_TIME_UNIT" }); seq.push(s.timeUnit); }
    expect(seq).toEqual(["frame", "tc", "barBeat", "sec", "frame"]);
  });

  it("TOGGLE_LANE は該当レーンだけ反転", () => {
    const s = viewReducer(initialViewState(), { type: "TOGGLE_LANE", lane: "hits" });
    expect(s.laneVisibility.hits).toBe(false);
    expect(s.laneVisibility.beatGrid).toBe(true);
  });

  it("SET_SNAP / SET_LOOP / SET_FOLLOW", () => {
    let s = viewReducer(initialViewState(), { type: "SET_SNAP", mode: "bar" });
    expect(s.snapMode).toBe("bar");
    s = viewReducer(s, { type: "SET_LOOP", loop: { a: 1, b: 2 } });
    expect(s.loop).toEqual({ a: 1, b: 2 });
    s = viewReducer(s, { type: "SET_LOOP", loop: null });
    expect(s.loop).toBeNull();
    s = viewReducer(s, { type: "SET_FOLLOW", on: false });
    expect(s.followPlayhead).toBe(false);
  });
});
