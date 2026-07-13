/** エディタ表示状態(zoom/scroll/snap/timeUnit/レーン表示/ループ/追従)。undo 対象外(スペック §7)。
 *  React context + useReducer。純 reducer は直接テストできるよう export する。 */
import React, { createContext, useContext, useReducer } from "react";

import type { SnapMode } from "../editor/snap.js";
import type { TimeUnit } from "../editor/timeFormat.js";

export interface LaneVisibility {
  beatGrid: boolean;
  sections: boolean;
  hits: boolean;
  silence: boolean;
}

export interface ViewState {
  zoomSamplesPerPx: number; // 波形の水平密度(サンプル/px)
  scrollSec: number;        // 表示左端の曲内秒
  snapMode: SnapMode;
  timeUnit: TimeUnit;
  laneVisibility: LaneVisibility;
  loop: { a: number; b: number } | null;
  followPlayhead: boolean;
}

export type ViewAction =
  | { type: "SET_VIEW"; scrollSec?: number; zoomSamplesPerPx?: number }
  | { type: "SET_SNAP"; mode: SnapMode }
  | { type: "SET_TIME_UNIT"; unit: TimeUnit }
  | { type: "CYCLE_TIME_UNIT" }
  | { type: "TOGGLE_LANE"; lane: keyof LaneVisibility }
  | { type: "SET_LOOP"; loop: { a: number; b: number } | null }
  | { type: "SET_FOLLOW"; on: boolean };

const UNIT_ORDER: TimeUnit[] = ["sec", "frame", "tc", "barBeat"];

export function initialViewState(): ViewState {
  return {
    zoomSamplesPerPx: 1024,
    scrollSec: 0,
    snapMode: "beat",
    timeUnit: "tc",
    laneVisibility: { beatGrid: true, sections: true, hits: true, silence: true },
    loop: null,
    followPlayhead: true,
  };
}

export function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case "SET_VIEW":
      return {
        ...state,
        scrollSec: action.scrollSec ?? state.scrollSec,
        zoomSamplesPerPx: action.zoomSamplesPerPx ?? state.zoomSamplesPerPx,
      };
    case "SET_SNAP":
      return { ...state, snapMode: action.mode };
    case "SET_TIME_UNIT":
      return { ...state, timeUnit: action.unit };
    case "CYCLE_TIME_UNIT": {
      const i = UNIT_ORDER.indexOf(state.timeUnit);
      return { ...state, timeUnit: UNIT_ORDER[(i + 1) % UNIT_ORDER.length]! };
    }
    case "TOGGLE_LANE":
      return {
        ...state,
        laneVisibility: { ...state.laneVisibility, [action.lane]: !state.laneVisibility[action.lane] },
      };
    case "SET_LOOP":
      return { ...state, loop: action.loop };
    case "SET_FOLLOW":
      return { ...state, followPlayhead: action.on };
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

interface ViewStoreValue {
  view: ViewState;
  dispatch: React.Dispatch<ViewAction>;
}

const ViewStoreContext = createContext<ViewStoreValue | null>(null);

export function ViewStoreProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const [view, dispatch] = useReducer(viewReducer, undefined, initialViewState);
  return React.createElement(ViewStoreContext.Provider, { value: { view, dispatch } }, props.children);
}

export function useViewStore(): ViewStoreValue {
  const v = useContext(ViewStoreContext);
  if (!v) throw new Error("useViewStore は ViewStoreProvider の内側で使う必要があります");
  return v;
}
