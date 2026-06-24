import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { clickArgs, int, usage } from "../src/cli.ts";

afterEach(() => {
  mock.restore();
});

function captureExit(): { error: string[]; exited: number[] } {
  const error: string[] = [];
  const exited: number[] = [];
  spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    error.push(a.join(" "));
  });
  spyOn(process, "exit").mockImplementation(((code?: number) => {
    exited.push(code ?? 0);
    throw new Error(`__exit_${code ?? 0}`);
  }) as never);
  return { error, exited };
}

describe("int", () => {
  test("parses finite numbers, including negatives and floats", () => {
    expect(int("42", "x")).toBe(42);
    expect(int("-7", "x")).toBe(-7);
    expect(int("3.5", "x")).toBe(3.5);
    expect(int("0", "x")).toBe(0);
  });

  test("usage-exits on non-numeric / empty / undefined", () => {
    for (const bad of [undefined, "", "abc", "NaN"]) {
      const { error, exited } = captureExit();
      expect(() => int(bad, "x")).toThrow(/__exit_1/);
      expect(exited).toEqual([1]);
      expect(error.join("\n")).toMatch(/<x> must be a number/);
      mock.restore();
    }
  });
});

describe("clickArgs", () => {
  test("no positions: just button and count", () => {
    expect(clickArgs([], "left", 1)).toEqual({ button: "left", count: 1 });
  });

  test("two positions: parses x and y", () => {
    expect(clickArgs(["100", "200"], "right", 2)).toEqual({
      button: "right",
      count: 2,
      x: 100,
      y: 200,
    });
  });

  test("ignores extra positions beyond the first two", () => {
    expect(clickArgs(["1", "2", "3"], "left", 1)).toEqual({
      button: "left",
      count: 1,
      x: 1,
      y: 2,
    });
  });

  test("single position is rejected", () => {
    const { error, exited } = captureExit();
    expect(() => clickArgs(["100"], "left", 1)).toThrow(/__exit_1/);
    expect(exited).toEqual([1]);
    expect(error.join("\n")).toMatch(/pass both x and y or neither/);
  });

  test("non-numeric position usage-exits via int", () => {
    const { exited } = captureExit();
    expect(() => clickArgs(["foo", "bar"], "left", 1)).toThrow(/__exit_1/);
    expect(exited).toEqual([1]);
  });
});

describe("usage", () => {
  test("prints prefixed message to stderr and exits 1", () => {
    const { error, exited } = captureExit();
    expect(() => usage("mimic move <x> <y>")).toThrow(/__exit_1/);
    expect(exited).toEqual([1]);
    expect(error).toEqual(["usage: mimic move <x> <y>"]);
  });
});
