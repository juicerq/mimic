import { describe, expect, test } from "bun:test";
import { encode, MAX_REQUEST_BYTES, type Request, type Response } from "../src/service.ts";

const decode = (line: string): Request | Response => JSON.parse(line.replace(/\n$/, ""));

describe("encode", () => {
  test("terminates each frame with a single newline", () => {
    const out = encode({ action: "ping" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.indexOf("\n")).toBe(out.length - 1);
  });

  test("round-trips a Request", () => {
    const req: Request = { action: "move", args: { x: 100, y: 200 }, dry: true };
    expect(decode(encode(req))).toEqual(req);
  });

  test("round-trips an ok Response", () => {
    const res: Response = { ok: true, result: [10, 20] };
    expect(decode(encode(res))).toEqual(res);
  });

  test("round-trips an error Response", () => {
    const res: Response = { ok: false, error: "boom" };
    expect(decode(encode(res))).toEqual(res);
  });

  test("framing: concatenated frames split cleanly on newline", () => {
    const a = encode({ action: "ping" });
    const b = encode({ ok: true, result: "pong" });
    const stream = a + b;
    const lines = stream.split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    expect(decode(lines[0])).toEqual({ action: "ping" });
    expect(decode(lines[1])).toEqual({ ok: true, result: "pong" });
  });

  test("payload contains no raw newline that would break framing", () => {
    const req: Request = { action: "type", args: { text: "line1\nline2" } };
    const encoded = encode(req);
    expect(encoded.indexOf("\n")).toBe(encoded.length - 1);
    expect(decode(encoded)).toEqual(req);
  });
});

describe("MAX_REQUEST_BYTES", () => {
  test("is 1 MiB", () => {
    expect(MAX_REQUEST_BYTES).toBe(1 << 20);
  });
});
