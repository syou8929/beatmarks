import { describe, expect, it } from "vitest";

import {
  FPS_PRESETS, fpsValue, fpsLabel,
  timeToFrame, frameToTime, formatTimecode, formatSeconds,
} from "../timebase.js";

describe("FPS_PRESETS", () => {
  it("NTSC系は分数で表現される", () => {
    expect(FPS_PRESETS["29.97"]).toEqual({ num: 30000, den: 1001 });
    expect(FPS_PRESETS["23.976"]).toEqual({ num: 24000, den: 1001 });
    expect(FPS_PRESETS["59.94"]).toEqual({ num: 60000, den: 1001 });
    expect(FPS_PRESETS["30"]).toEqual({ num: 30, den: 1 });
  });
});

describe("timeToFrame / frameToTime", () => {
  it("30fpsの基本変換", () => {
    expect(timeToFrame(1.0, FPS_PRESETS["30"]!, "nearest")).toBe(30);
    expect(timeToFrame(59.999, FPS_PRESETS["30"]!, "nearest")).toBe(1800);
    expect(timeToFrame(0.9999, FPS_PRESETS["30"]!, "floor")).toBe(29);
    expect(frameToTime(30, FPS_PRESETS["30"]!)).toBeCloseTo(1.0, 12);
  });

  it("29.97はround(t*30000/1001)と厳密一致", () => {
    const fps = FPS_PRESETS["29.97"]!;
    for (const t of [0, 0.5, 1, 10, 59.94, 123.456, 600]) {
      expect(timeToFrame(t, fps, "nearest")).toBe(Math.round((t * 30000) / 1001));
      expect(timeToFrame(t, fps, "floor")).toBe(Math.floor((t * 30000) / 1001));
    }
  });

  it("29.97で10分・0.5s刻みでも累積誤差なし(単調・重複/飛びが想定どおり)", () => {
    const fps = FPS_PRESETS["29.97"]!;
    let prev = -1;
    for (let i = 0; i <= 1200; i++) {
      const t = i * 0.5;
      const f = timeToFrame(t, fps, "nearest");
      const expected = Math.round((t * 30000) / 1001);
      expect(f).toBe(expected);           // 都度丸め=真値。累積計算をしていない証明
      expect(f).toBeGreaterThan(prev);    // 0.5s刻み(≈14.985f)は単調増加
      prev = f;
    }
    // 10分地点: 600s * 29.97002997 ≈ 17982.0…
    expect(timeToFrame(600, fps, "nearest")).toBe(Math.round((600 * 30000) / 1001));
  });

  it("負や極小の時刻も安全", () => {
    expect(timeToFrame(0, FPS_PRESETS["24"]!, "nearest")).toBe(0);
    expect(timeToFrame(-0.0001, FPS_PRESETS["24"]!, "nearest")).toBe(0); // 0未満は0へクランプ
  });
});

describe("formatTimecode(ノンドロップ)", () => {
  it("30fps", () => {
    expect(formatTimecode(0, FPS_PRESETS["30"]!)).toBe("00:00:00:00");
    expect(formatTimecode(29, FPS_PRESETS["30"]!)).toBe("00:00:00:29");
    expect(formatTimecode(30, FPS_PRESETS["30"]!)).toBe("00:00:01:00");
    expect(formatTimecode(1800, FPS_PRESETS["30"]!)).toBe("00:01:00:00");
    expect(formatTimecode(30 * 3600, FPS_PRESETS["30"]!)).toBe("01:00:00:00");
  });

  it("29.97はTCベース30のノンドロップ", () => {
    const fps = FPS_PRESETS["29.97"]!;
    expect(formatTimecode(30, fps)).toBe("00:00:01:00");
    expect(formatTimecode(17982, fps)).toBe("00:09:59:12"); // 17982 = 599*30+12
  });

  it("23.976はTCベース24", () => {
    expect(formatTimecode(24, FPS_PRESETS["23.976"]!)).toBe("00:00:01:00");
  });
});

describe("ラベル整形", () => {
  it("fpsValue / fpsLabel", () => {
    expect(fpsValue(FPS_PRESETS["29.97"]!)).toBeCloseTo(29.97002997, 6);
    expect(fpsLabel(FPS_PRESETS["29.97"]!)).toBe("29.97");
    expect(fpsLabel({ num: 48, den: 1 })).toBe("48");
  });

  it("formatSeconds はms 3桁固定", () => {
    expect(formatSeconds(1.5)).toBe("1.500");
    expect(formatSeconds(0)).toBe("0.000");
    expect(formatSeconds(12.3456)).toBe("12.346");
  });
});
