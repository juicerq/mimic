import { describe, expect, test } from "bun:test";
import { parseEnv, parseKscreen, parseWlrRandr } from "../src/desktop.ts";

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
