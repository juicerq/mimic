import { describe, expect, test } from "bun:test";
import { ABS_X, ABS_Y, EV_ABS } from "../src/codes.ts";
import { Hands } from "../src/hands.ts";
import type { DeviceFactory, DeviceSpec, VirtualDevice } from "../src/uinput.ts";

interface Point {
  x: number;
  y: number;
}

class FakePointer implements VirtualDevice {
  points: Point[] = [];
  private pending: Partial<Point> = {};

  emit(type: number, code: number, value: number): void {
    if (type !== EV_ABS) return;
    if (code === ABS_X) this.pending.x = value;
    if (code === ABS_Y) this.pending.y = value;
  }

  syn(): void {
    if (this.pending.x !== undefined && this.pending.y !== undefined) {
      this.points.push({ x: this.pending.x, y: this.pending.y });
    }
    this.pending = {};
  }

  close(): void {}
}

class NoopDevice implements VirtualDevice {
  emit(): void {}
  syn(): void {}
  close(): void {}
}

function makeHands(width: number, height: number) {
  const pointer = new FakePointer();
  const factory: DeviceFactory = (spec: DeviceSpec) => (spec.abs?.length ? pointer : new NoopDevice());
  const hands = new Hands(width, height, { createDevice: factory, config: { warmupMs: 0 } });
  return { hands, pointer };
}

describe("Hands.move math", () => {
  test("ends exactly at the requested destination", async () => {
    const { hands, pointer } = makeHands(1920, 1080);
    await hands.move(800, 600);
    const last = pointer.points.at(-1)!;
    expect(last).toEqual({ x: 800, y: 600 });
    expect(hands.x).toBe(800);
    expect(hands.y).toBe(600);
  });

  test("clamps destination into [0,width-1] x [0,height-1]", async () => {
    const { hands, pointer } = makeHands(100, 100);
    await hands.move(500, -50);
    const last = pointer.points.at(-1)!;
    expect(last).toEqual({ x: 99, y: 0 });
    expect(hands.x).toBe(99);
    expect(hands.y).toBe(0);
  });

  test("never emits a point outside the screen bounds", async () => {
    const { hands, pointer } = makeHands(200, 150);
    await hands.move(0, 0);
    pointer.points.length = 0;
    await hands.move(199, 149);
    await hands.move(0, 149);
    await hands.move(120, 30);
    for (const p of pointer.points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(199);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(149);
    }
  });

  test("first emitted step is near the origin, not jumping straight to target", async () => {
    const { hands, pointer } = makeHands(1920, 1080);
    await hands.move(50, 50);
    pointer.points.length = 0;
    await hands.move(1800, 1000);
    const first = pointer.points[0];
    const distFromOrigin = Math.hypot(first.x - 50, first.y - 50);
    const distToTarget = Math.hypot(first.x - 1800, first.y - 1000);
    expect(distFromOrigin).toBeLessThan(distToTarget);
  });

  test("progress toward the target is approximately monotonic", async () => {
    const { hands, pointer } = makeHands(1920, 1080);
    await hands.move(100, 100);
    pointer.points.length = 0;
    const target = { x: 1700, y: 900 };
    await hands.move(target.x, target.y);

    const remaining = pointer.points.map((p) => Math.hypot(p.x - target.x, p.y - target.y));
    let regressions = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (remaining[i] > remaining[i - 1] + 5) regressions++;
    }
    expect(regressions).toBeLessThanOrEqual(2);
    expect(remaining.at(-1)).toBe(0);
  });

  test("step count scales with distance and respects minSteps", async () => {
    const { hands, pointer } = makeHands(4000, 4000);
    await hands.move(0, 0);

    pointer.points.length = 0;
    await hands.move(2, 0);
    const shortSteps = pointer.points.length;

    await hands.move(0, 0);
    pointer.points.length = 0;
    await hands.move(2000, 0);
    const longSteps = pointer.points.length;

    expect(shortSteps).toBeGreaterThanOrEqual(12);
    expect(longSteps).toBeGreaterThan(shortSteps);
  });

  test("tiny moves below moveMinDist snap directly to destination", async () => {
    const { hands, pointer } = makeHands(1920, 1080);
    await hands.move(500, 500);
    pointer.points.length = 0;
    await hands.move(501, 500);
    expect(pointer.points).toEqual([{ x: 501, y: 500 }]);
  });

  test("rejects non-finite coordinates", async () => {
    const { hands } = makeHands(1920, 1080);
    await expect(hands.move(Number.NaN, 10)).rejects.toThrow(/invalid x/);
    await expect(hands.move(10, Number.POSITIVE_INFINITY)).rejects.toThrow(/invalid y/);
  });
});

describe("Hands constructor", () => {
  test("rejects invalid screen size", () => {
    const factory: DeviceFactory = () => new NoopDevice();
    expect(() => new Hands(0, 100, { createDevice: factory })).toThrow(/invalid screen size/);
    expect(() => new Hands(100, -1, { createDevice: factory })).toThrow(/invalid screen size/);
    expect(() => new Hands(100.5, 100, { createDevice: factory })).toThrow(/invalid screen size/);
  });

  test("starts centered", () => {
    const { hands } = makeHands(1920, 1080);
    expect(hands.x).toBe(960);
    expect(hands.y).toBe(540);
  });

  test("closes created devices if one factory call throws", () => {
    const closed: string[] = [];
    let n = 0;
    const factory: DeviceFactory = (spec) => {
      if (n++ === 2) throw new Error("third device fails");
      return {
        emit() {},
        syn() {},
        close() {
          closed.push(spec.name);
        },
      };
    };
    expect(() => new Hands(100, 100, { createDevice: factory })).toThrow(/third device fails/);
    expect(closed.length).toBe(2);
  });
});

describe("Hands.type", () => {
  test("reports typed count and skipped characters", async () => {
    const { hands } = makeHands(1920, 1080);
    const result = await hands.type("aé");
    expect(result.typed).toBe(1);
    expect(result.skipped).toEqual(["é"]);
  });
});
