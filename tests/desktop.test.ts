import { describe, expect, test } from "bun:test";
import { type Gray, gridDraw, match, parseEnv, parseKscreen, parseWlrRandr } from "../src/desktop.ts";

describe("parseEnv", () => {
  test("parses WxH", () => {
    expect(parseEnv("1920x1080")).toEqual({ width: 1920, height: 1080 });
    expect(parseEnv("2560x1440")).toEqual({ width: 2560, height: 1440 });
  });

  test("rejects garbage", () => {
    expect(parseEnv("")).toBeNull();
    expect(parseEnv("1920")).toBeNull();
    expect(parseEnv("1920X1080")).toBeNull();
    expect(parseEnv("1920x1080x1")).toBeNull();
    expect(parseEnv("foo")).toBeNull();
    expect(parseEnv(" 1920x1080 ")).toBeNull();
  });

  test("rejects zero dimensions", () => {
    expect(parseEnv("0x1080")).toBeNull();
    expect(parseEnv("1920x0")).toBeNull();
    expect(parseEnv("0x0")).toBeNull();
  });
});

describe("parseKscreen", () => {
  const fixture = `Output: 1 eDP-1
	enabled
	connected
	priority 1
	Modes:  1:1920x1080@60*!  2:1680x1050@60
	Geometry: 0,0 1920x1080
	Scale: 1
	Rotation: 1`;

  test("extracts geometry from kscreen-doctor -o output", () => {
    expect(parseKscreen(fixture)).toEqual({ width: 1920, height: 1080 });
  });

  test("handles non-zero origin", () => {
    const out = "\tGeometry: 1920,0 2560x1440\n";
    expect(parseKscreen(out)).toEqual({ width: 2560, height: 1440 });
  });

  test("returns null when no geometry line", () => {
    expect(parseKscreen("Output: 1 eDP-1\n\tenabled\n")).toBeNull();
    expect(parseKscreen("")).toBeNull();
  });

  test("rejects zero geometry", () => {
    expect(parseKscreen("Geometry: 0,0 0x0")).toBeNull();
  });
});

describe("parseWlrRandr", () => {
  const fixture = `HDMI-A-1 "Samsung Electric Company"
  Make: Samsung
  Modes:
    1920x1080 px, 60.000000 Hz (preferred, current)
    1680x1050 px, 59.883000 Hz
  Position: 0,0`;

  test("extracts current mode from wlr-randr output", () => {
    expect(parseWlrRandr(fixture)).toEqual({ width: 1920, height: 1080 });
  });

  test("case-insensitive Current", () => {
    const out = "    2560x1440 px, 144.000 Hz (Current)\n";
    expect(parseWlrRandr(out)).toEqual({ width: 2560, height: 1440 });
  });

  test("returns null when no current mode", () => {
    const out = "    1920x1080 px, 60.000 Hz (preferred)\n";
    expect(parseWlrRandr(out)).toBeNull();
    expect(parseWlrRandr("")).toBeNull();
  });

  test("rejects zero dimensions", () => {
    expect(parseWlrRandr("    0x0 px, 60 Hz (current)")).toBeNull();
  });
});

describe("match", () => {
  // a haystack with a distinctive 3x3 cross stamped at (5,4) on a noisy field
  function haystack(): Gray {
    const width = 16;
    const height = 12;
    const px = new Float64Array(width * height);
    for (let i = 0; i < px.length; i++) px[i] = ((i * 37) % 11) / 40; // low-contrast varied background
    const cross = [
      [0, 1, 0],
      [1, 1, 1],
      [0, 1, 0],
    ];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) px[(4 + j) * width + (5 + i)] = cross[j][i];
    return { px, width, height };
  }

  const template: Gray = {
    width: 3,
    height: 3,
    px: Float64Array.from([0, 1, 0, 1, 1, 1, 0, 1, 0]),
  };

  test("locates the template's center with a high score", () => {
    const hit = match(haystack(), template);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(6); // top-left 5 + (3>>1)=1
    expect(hit!.y).toBe(5); // top-left 4 + 1
    expect(hit!.score).toBeGreaterThan(0.9);
  });

  test("rejects a featureless template", () => {
    const flat: Gray = { width: 3, height: 3, px: new Float64Array(9).fill(0.5) };
    expect(match(haystack(), flat)).toBeNull();
  });
});

describe("gridDraw", () => {
  test("labels lines in original screen coords, offset by the region and scaled by zoom", () => {
    const draw = gridDraw({ x: 100, y: 50, width: 200, height: 200 }, 2, 100);
    // first vertical line is at original x=100 -> output px (100-100)*2 = 0, labelled 100
    expect(draw).toContain("line 0,0 0,400");
    expect(draw).toContain("text 2,14 '100'");
    // next at x=200 -> (200-100)*2 = 200
    expect(draw).toContain("line 200,0 200,400");
    expect(draw).toContain("text 202,14 '200'");
    // first horizontal line at original y=100 -> (100-50)*2 = 100
    expect(draw).toContain("line 0,100 400,100");
    expect(draw).toContain("text 2,114 '100'");
  });

  test("emits nothing when the region holds no grid multiple", () => {
    expect(gridDraw({ x: 10, y: 10, width: 30, height: 30 }, 1, 100)).toBe("");
  });
});
