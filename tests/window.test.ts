import { describe, expect, test } from "bun:test";
import { parseWindowLine } from "../src/window.ts";

describe("parseWindowLine", () => {
  const token = "MIMICabc123";

  test("parses a tab-delimited window record after the token", () => {
    const line = `${token} firefox\tMozilla Firefox\t0\t27\t1920\t1053\tfalse`;
    expect(parseWindowLine(line, token)).toEqual({
      class: "firefox",
      caption: "Mozilla Firefox",
      x: 0,
      y: 27,
      width: 1920,
      height: 1053,
      active: false,
    });
  });

  test("strips any journald prefix before the token and reads active=true", () => {
    const line = `Jun 25 14:00:00 host kwin_wayland[123]: ${token} steam\tTask Bar Hero\t640\t360\t800\t600\ttrue`;
    expect(parseWindowLine(line, token)).toMatchObject({ class: "steam", active: true });
  });

  test("returns null for lines without the token or with too few fields", () => {
    expect(parseWindowLine("unrelated log line", token)).toBeNull();
    expect(parseWindowLine(`${token} firefox\tonly\tthree`, token)).toBeNull();
  });
});
