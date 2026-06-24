import { describe, expect, test } from "bun:test";
import { ABS_X, ABS_Y, EV_ABS, EV_KEY, EV_REL, REL_WHEEL } from "../src/codes.ts";
import { countKey, countRel, decodeEvents, lastAbs, type InputEvent } from "../src/selftest.ts";

const EVENT_SIZE = 24;

function pack(events: InputEvent[]): Buffer {
  const buffer = Buffer.alloc(EVENT_SIZE * events.length);
  events.forEach((event, index) => {
    const off = index * EVENT_SIZE;
    buffer.writeUInt16LE(event.type, off + 16);
    buffer.writeUInt16LE(event.code, off + 18);
    buffer.writeInt32LE(event.value, off + 20);
  });
  return buffer;
}

describe("decodeEvents", () => {
  test("round-trips packed events", () => {
    const events: InputEvent[] = [
      { type: EV_ABS, code: ABS_X, value: 640 },
      { type: EV_KEY, code: 30, value: 1 },
      { type: EV_REL, code: REL_WHEEL, value: -1 },
    ];
    expect(decodeEvents(pack(events), events.length * EVENT_SIZE)).toEqual(events);
  });

  test("ignores a trailing partial event", () => {
    const events: InputEvent[] = [{ type: EV_ABS, code: ABS_Y, value: 12 }];
    const buffer = pack(events);
    expect(decodeEvents(buffer, EVENT_SIZE + 10)).toEqual(events);
  });

  test("returns nothing for zero bytes", () => {
    expect(decodeEvents(Buffer.alloc(EVENT_SIZE), 0)).toEqual([]);
  });
});

describe("lastAbs", () => {
  test("returns the final value for an axis", () => {
    const events: InputEvent[] = [
      { type: EV_ABS, code: ABS_X, value: 10 },
      { type: EV_ABS, code: ABS_X, value: 300 },
      { type: EV_ABS, code: ABS_Y, value: 200 },
    ];
    expect(lastAbs(events, ABS_X)).toBe(300);
    expect(lastAbs(events, ABS_Y)).toBe(200);
  });

  test("returns null when the axis is absent", () => {
    expect(lastAbs([{ type: EV_KEY, code: 30, value: 1 }], ABS_X)).toBeNull();
  });
});

describe("countKey / countRel", () => {
  test("counts presses and releases by code and value", () => {
    const events: InputEvent[] = [
      { type: EV_KEY, code: 30, value: 1 },
      { type: EV_KEY, code: 30, value: 0 },
      { type: EV_KEY, code: 48, value: 1 },
    ];
    expect(countKey(events, 30, 1)).toBe(1);
    expect(countKey(events, 30, 0)).toBe(1);
    expect(countKey(events, 48, 1)).toBe(1);
    expect(countKey(events, 48, 0)).toBe(0);
  });

  test("counts wheel notches by direction", () => {
    const events: InputEvent[] = [
      { type: EV_REL, code: REL_WHEEL, value: -1 },
      { type: EV_REL, code: REL_WHEEL, value: -1 },
      { type: EV_REL, code: REL_WHEEL, value: 1 },
    ];
    expect(countRel(events, REL_WHEEL, -1)).toBe(2);
    expect(countRel(events, REL_WHEEL, 1)).toBe(1);
  });
});
