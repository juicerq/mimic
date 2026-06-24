import {
  ABS_X,
  ABS_Y,
  BTN_LEFT,
  BTN_MIDDLE,
  BTN_RIGHT,
  charStroke,
  EV_ABS,
  EV_KEY,
  EV_REL,
  KEY,
  KEYBOARD_KEYS,
  REL_HWHEEL,
  REL_WHEEL,
  resolveKey,
} from "./codes.ts";
import { createUinputDevice, type DeviceFactory, type VirtualDevice } from "./uinput.ts";

export type Button = "left" | "right" | "middle";

const BUTTON: Record<Button, number> = {
  left: BTN_LEFT,
  right: BTN_RIGHT,
  middle: BTN_MIDDLE,
};

type Range = [min: number, max: number];

export interface HandsConfig {
  warmupMs: number;
  warmupSettleMs: number;
  warmupCenterMs: number;
  moveMinDist: number;
  moveMaxMs: number;
  moveBaseMs: number;
  moveMsPerPx: number;
  moveSpeedJitter: Range;
  stepPx: number;
  minSteps: number;
  stepDelayJitter: Range;
  jitterPx: number;
  bowFraction: number;
  clickMoveSettle: Range;
  clickDownMs: Range;
  clickGapMs: Range;
  dragPreMs: Range;
  dragHoldMs: Range;
  dragPostMs: Range;
  scrollStepMs: Range;
  tapHoldMs: Range;
  typeGapMs: Range;
  pasteSettleMs: number;
}

export const DEFAULT_HANDS_CONFIG: HandsConfig = {
  warmupMs: Number(Bun.env.MIMIC_WARMUP ?? "2500"),
  warmupSettleMs: 80,
  warmupCenterMs: 120,
  moveMinDist: 1.5,
  moveMaxMs: 1200,
  moveBaseMs: 120,
  moveMsPerPx: 1 / 1.6,
  moveSpeedJitter: [0.8, 1.25],
  stepPx: 6,
  minSteps: 12,
  stepDelayJitter: [0.6, 1.4],
  jitterPx: 1,
  bowFraction: 0.12,
  clickMoveSettle: [40, 120],
  clickDownMs: [50, 110],
  clickGapMs: [60, 130],
  dragPreMs: [50, 150],
  dragHoldMs: [80, 180],
  dragPostMs: [50, 150],
  scrollStepMs: [40, 120],
  tapHoldMs: [12, 45],
  typeGapMs: [30, 120],
  pasteSettleMs: 100,
};

export interface TypeResult {
  typed: number;
  skipped: string[];
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const range = ([min, max]: Range) => rand(min, max);
const sleep = (ms: number) => Bun.sleep(ms);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function finite(n: number, name: string) {
  if (!Number.isFinite(n)) {
    throw new Error(`mimic: invalid ${name}`);
  }
}

export class Hands {
  private readonly pointer: VirtualDevice;
  private readonly wheel: VirtualDevice;
  private readonly keyboard: VirtualDevice;
  private readonly config: HandsConfig;

  x: number;
  y: number;

  constructor(
    readonly width: number,
    readonly height: number,
    deps: { createDevice?: DeviceFactory; config?: Partial<HandsConfig> } = {},
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error("mimic: invalid screen size");
    }

    this.config = { ...DEFAULT_HANDS_CONFIG, ...deps.config };
    const make = deps.createDevice ?? createUinputDevice;
    const created: VirtualDevice[] = [];

    try {
      this.pointer = make({
        name: "mimic-pointer",
        keys: [BTN_LEFT, BTN_RIGHT, BTN_MIDDLE],
        abs: [
          { code: ABS_X, min: 0, max: width - 1 },
          { code: ABS_Y, min: 0, max: height - 1 },
        ],
      });
      created.push(this.pointer);

      this.wheel = make({ name: "mimic-wheel", product: 0x0002, rel: [REL_WHEEL, REL_HWHEEL] });
      created.push(this.wheel);

      this.keyboard = make({ name: "mimic-keyboard", product: 0x0003, keys: KEYBOARD_KEYS });
      created.push(this.keyboard);
    } catch (e) {
      for (const d of created) {
        d.close();
      }
      throw e;
    }

    this.x = Math.floor(width / 2);
    this.y = Math.floor(height / 2);
  }

  async ready() {
    await sleep(this.config.warmupMs);
    this.place(0, 0);
    await sleep(this.config.warmupSettleMs);
    this.place(this.width - 1, this.height - 1);
    await sleep(this.config.warmupSettleMs);
    this.place(Math.floor(this.width / 2), Math.floor(this.height / 2));
    await sleep(this.config.warmupCenterMs);
  }

  private place(x: number, y: number) {
    const px = clamp(Math.round(x), 0, this.width - 1);
    const py = clamp(Math.round(y), 0, this.height - 1);
    this.pointer.emit(EV_ABS, ABS_X, px);
    this.pointer.emit(EV_ABS, ABS_Y, py);
    this.pointer.syn();
    this.x = px;
    this.y = py;
  }

  async move(x: number, y: number, durationMs?: number) {
    finite(x, "x");
    finite(y, "y");

    const x0 = this.x;
    const y0 = this.y;
    const dist = Math.hypot(x - x0, y - y0);
    if (dist < this.config.moveMinDist) {
      this.place(x, y);
      return;
    }

    const total =
      durationMs ??
      Math.min(this.config.moveMaxMs, this.config.moveBaseMs + dist * this.config.moveMsPerPx) *
        range(this.config.moveSpeedJitter);
    const steps = Math.max(this.config.minSteps, Math.floor(dist / this.config.stepPx));

    const mx = (x0 + x) / 2;
    const my = (y0 + y) / 2;
    const nx = -(y - y0);
    const ny = x - x0;
    const nlen = Math.hypot(nx, ny) || 1;
    const bow = rand(-this.config.bowFraction, this.config.bowFraction) * dist;
    const cx = mx + (nx / nlen) * bow;
    const cy = my + (ny / nlen) * bow;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t * t * (3 - 2 * t);
      const u = 1 - e;
      let px = u * u * x0 + 2 * u * e * cx + e * e * x;
      let py = u * u * y0 + 2 * u * e * cy + e * e * y;
      if (i < steps) {
        px += rand(-this.config.jitterPx, this.config.jitterPx);
        py += rand(-this.config.jitterPx, this.config.jitterPx);
      }
      this.place(px, py);
      await sleep((total / steps) * range(this.config.stepDelayJitter));
    }
    this.place(x, y);
  }

  private button(code: number, pressed: boolean) {
    this.pointer.emit(EV_KEY, code, pressed ? 1 : 0);
    this.pointer.syn();
  }

  async click(x?: number, y?: number, button: Button = "left", count = 1) {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("mimic: invalid count");
    }
    if (x !== undefined && y !== undefined) {
      finite(x, "x");
      finite(y, "y");
      await this.move(x, y);
      await sleep(range(this.config.clickMoveSettle));
    }
    const code = BUTTON[button];
    for (let n = 0; n < count; n++) {
      this.button(code, true);
      await sleep(range(this.config.clickDownMs));
      this.button(code, false);
      if (n + 1 < count) await sleep(range(this.config.clickGapMs));
    }
  }

  async drag(x1: number, y1: number, x2: number, y2: number, button: Button = "left") {
    finite(x1, "x1");
    finite(y1, "y1");
    finite(x2, "x2");
    finite(y2, "y2");

    const code = BUTTON[button];
    await this.move(x1, y1);
    await sleep(range(this.config.dragPreMs));
    this.button(code, true);
    await sleep(range(this.config.dragHoldMs));
    await this.move(x2, y2);
    await sleep(range(this.config.dragPostMs));
    this.button(code, false);
  }

  async scroll(amount: number) {
    if (!Number.isInteger(amount)) {
      throw new Error("mimic: invalid amount");
    }
    const step = amount > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(amount); i++) {
      this.wheel.emit(EV_REL, REL_WHEEL, step);
      this.wheel.syn();
      await sleep(range(this.config.scrollStepMs));
    }
  }

  private async tap(code: number, mods: number[] = []) {
    for (const mod of mods) this.keyboard.emit(EV_KEY, mod, 1);
    if (mods.length) this.keyboard.syn();
    this.keyboard.emit(EV_KEY, code, 1);
    this.keyboard.syn();
    await sleep(range(this.config.tapHoldMs));
    this.keyboard.emit(EV_KEY, code, 0);
    this.keyboard.syn();
    for (const mod of [...mods].reverse()) this.keyboard.emit(EV_KEY, mod, 0);
    if (mods.length) this.keyboard.syn();
  }

  async type(text: string): Promise<TypeResult> {
    let typed = 0;
    const skipped: string[] = [];
    for (const ch of text) {
      const stroke = charStroke(ch);
      if (!stroke) {
        skipped.push(ch);
        continue;
      }
      await this.tap(stroke.code, stroke.shift ? [KEY.LEFTSHIFT] : []);
      await sleep(range(this.config.typeGapMs));
      typed++;
    }
    return { typed, skipped };
  }

  async key(combo: string) {
    const names = combo.toLowerCase().replace(/\+/g, " ").split(/\s+/).filter(Boolean);
    const codes = names.map(resolveKey);
    const last = codes.pop();
    if (last === undefined) return;
    await this.tap(last, codes);
  }

  async paste(text: string) {
    const proc = Bun.spawn(["wl-copy", text]);
    if ((await proc.exited) !== 0) {
      throw new Error("mimic: wl-copy failed (is wl-clipboard installed?)");
    }
    await sleep(this.config.pasteSettleMs);
    await this.key("ctrl+v");
  }

  home() {
    this.place(Math.floor(this.width / 2), Math.floor(this.height / 2));
  }

  close() {
    let first: unknown;
    for (const d of [this.pointer, this.wheel, this.keyboard]) {
      try {
        d.close();
      } catch (e) {
        if (first === undefined) first = e;
      }
    }
    if (first !== undefined) throw first;
  }
}
