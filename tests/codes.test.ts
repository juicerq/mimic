import { describe, expect, test } from "bun:test";
import { CHARS, charStroke, KEY, KEYBOARD_KEYS, resolveKey } from "../src/codes.ts";

describe("resolveKey", () => {
  test("resolves named keys", () => {
    expect(resolveKey("ctrl")).toBe(KEY.LEFTCTRL);
    expect(resolveKey("control")).toBe(KEY.LEFTCTRL);
    expect(resolveKey("shift")).toBe(KEY.LEFTSHIFT);
    expect(resolveKey("alt")).toBe(KEY.LEFTALT);
    expect(resolveKey("meta")).toBe(KEY.LEFTMETA);
    expect(resolveKey("super")).toBe(KEY.LEFTMETA);
    expect(resolveKey("enter")).toBe(KEY.ENTER);
    expect(resolveKey("esc")).toBe(KEY.ESC);
    expect(resolveKey("tab")).toBe(KEY.TAB);
    expect(resolveKey("space")).toBe(KEY.SPACE);
  });

  test("named keys are case-insensitive", () => {
    expect(resolveKey("CTRL")).toBe(KEY.LEFTCTRL);
    expect(resolveKey("Enter")).toBe(KEY.ENTER);
  });

  test("resolves function keys f1..f12", () => {
    expect(resolveKey("f1")).toBe(KEY.F1);
    expect(resolveKey("f12")).toBe(KEY.F12);
  });

  test("resolves single characters via CHARS code", () => {
    expect(resolveKey("a")).toBe(KEY.A);
    expect(resolveKey("Z")).toBe(KEY.Z);
    expect(resolveKey("5")).toBe(KEY.N5);
    expect(resolveKey("!")).toBe(KEY.N1);
  });

  test("throws on unknown key name", () => {
    expect(() => resolveKey("nope")).toThrow(/unknown key: nope/);
  });

  test("throws on unknown multi-char string", () => {
    expect(() => resolveKey("abc")).toThrow(/unknown key/);
  });

  test("throws on unmapped single char", () => {
    expect(() => resolveKey("é")).toThrow(/unknown key/);
  });
});

describe("charStroke / CHARS", () => {
  test("lowercase letters: no shift, correct code", () => {
    expect(charStroke("a")).toEqual({ code: KEY.A, shift: false });
    expect(charStroke("z")).toEqual({ code: KEY.Z, shift: false });
  });

  test("uppercase letters: shift, same code as lowercase", () => {
    expect(charStroke("A")).toEqual({ code: KEY.A, shift: true });
    expect(charStroke("Z")).toEqual({ code: KEY.Z, shift: true });
  });

  test("digits: no shift", () => {
    for (let d = 0; d <= 9; d++) {
      const code = KEY[`N${d}` as keyof typeof KEY];
      expect(charStroke(String(d))).toEqual({ code, shift: false });
    }
  });

  test("shifted digits map to the digit code with shift", () => {
    const cases: [string, number][] = [
      ["!", KEY.N1],
      ["@", KEY.N2],
      ["#", KEY.N3],
      ["$", KEY.N4],
      ["%", KEY.N5],
      ["^", KEY.N6],
      ["&", KEY.N7],
      ["*", KEY.N8],
      ["(", KEY.N9],
      [")", KEY.N0],
    ];
    for (const [ch, code] of cases) {
      expect(charStroke(ch)).toEqual({ code, shift: true });
    }
  });

  test("symbols: base no shift, shifted with shift, same code", () => {
    const cases: [base: string, shifted: string, key: keyof typeof KEY][] = [
      ["-", "_", "MINUS"],
      ["=", "+", "EQUAL"],
      ["[", "{", "LEFTBRACE"],
      ["]", "}", "RIGHTBRACE"],
      [";", ":", "SEMICOLON"],
      ["'", '"', "APOSTROPHE"],
      ["`", "~", "GRAVE"],
      ["\\", "|", "BACKSLASH"],
      [",", "<", "COMMA"],
      [".", ">", "DOT"],
      ["/", "?", "SLASH"],
    ];
    for (const [base, shifted, key] of cases) {
      expect(charStroke(base)).toEqual({ code: KEY[key], shift: false });
      expect(charStroke(shifted)).toEqual({ code: KEY[key], shift: true });
    }
  });

  test("whitespace strokes", () => {
    expect(charStroke(" ")).toEqual({ code: KEY.SPACE, shift: false });
    expect(charStroke("\t")).toEqual({ code: KEY.TAB, shift: false });
    expect(charStroke("\n")).toEqual({ code: KEY.ENTER, shift: false });
  });

  test("returns undefined for unmapped characters", () => {
    expect(charStroke("é")).toBeUndefined();
    expect(charStroke("€")).toBeUndefined();
    expect(charStroke("")).toBeUndefined();
  });

  test("CHARS is the same source as charStroke", () => {
    expect(CHARS.get("a")).toEqual(charStroke("a")!);
    expect(CHARS.get("$")).toEqual(charStroke("$")!);
  });
});

describe("KEYBOARD_KEYS", () => {
  test("has no duplicates", () => {
    expect(new Set(KEYBOARD_KEYS).size).toBe(KEYBOARD_KEYS.length);
  });

  test("contains every code in KEY", () => {
    const set = new Set(KEYBOARD_KEYS);
    for (const code of Object.values(KEY)) {
      expect(set.has(code)).toBe(true);
    }
  });

  test("contains every char stroke code", () => {
    const set = new Set(KEYBOARD_KEYS);
    for (const stroke of CHARS.values()) {
      expect(set.has(stroke.code)).toBe(true);
    }
  });
});
