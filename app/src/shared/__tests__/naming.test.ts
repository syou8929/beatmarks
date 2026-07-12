import { describe, expect, it } from "vitest";

import { buildFileName, TARGETS } from "../naming.js";
import { csvField, escapeJsString, escapeXml, selectMarkers } from "../exporters/helpers.js";
import type { Marker } from "../types.js";

describe("TARGETS / buildFileName", () => {
  it("略称テーブルがスペック§8と一致", () => {
    expect(TARGETS.aejsx).toEqual({ label: "After Effects", abbr: "AE", ext: "jsx" });
    expect(TARGETS.premiere.abbr).toBe("PPro");
    expect(TARGETS.resolve.abbr).toBe("Resolve");
    expect(TARGETS.midi).toEqual({ label: "MIDI", abbr: "markers", ext: "mid" });
    expect(TARGETS.wavcues.abbr).toBe("cues");
    expect(TARGETS.reaper.abbr).toBe("REAPER");
  });

  it("単一ソース: <base>_<abbr>.<ext>", () => {
    expect(buildFileName("track", null, "aejsx")).toBe("track_AE.jsx");
    expect(buildFileName("track", null, "json")).toBe("track_markers.json");
  });

  it("マルチソース: <base>_<source>_<abbr>.<ext>", () => {
    expect(buildFileName("MV_final", "Vo", "resolve")).toBe("MV_final_Vo_Resolve.edl");
  });

  it("危険文字はハイフンに置換", () => {
    expect(buildFileName("a/b:c", "L R", "csv")).toBe("a-b-c_L-R_markers.csv");
  });
});

describe("helpers", () => {
  it("selectMarkersは種別で選別", () => {
    const m = (type: Marker["type"]): Marker => ({
      id: type, sourceId: "s", timeSec: 0, type, label: "", color: "#000", source: "auto",
    });
    const got = selectMarkers([m("beat"), m("bar"), m("hit")], ["bar", "hit"]);
    expect(got.map((x) => x.type)).toEqual(["bar", "hit"]);
  });

  it("escapeXml", () => {
    expect(escapeXml(`a<b>&"c"'d'`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;&apos;d&apos;");
  });

  it("escapeJsStringはES3安全+非ASCIIを\\uXXXX化", () => {
    expect(escapeJsString(`a'b"c\\d`)).toBe(`a\\'b\\"c\\\\d`);
    expect(escapeJsString("改行\nタブ\t")).toBe("\\u6539\\u884c\\n\\u30bf\\u30d6\\t");
  });

  it("csvField", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('with "quote", comma')).toBe('"with ""quote"", comma"');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
  });
});
