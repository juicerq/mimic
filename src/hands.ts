import { VirtualDevice } from "./uinput.ts";
import {
  ABS_X, ABS_Y, BTN_LEFT, BTN_MIDDLE, BTN_RIGHT, CHARS,
  EV_ABS, EV_KEY, EV_REL, KEY, KEYBOARD_KEYS, REL_HWHEEL, REL_WHEEL, resolveKey,
} from "./codes.ts";

export type Button = "left" | "right" | "middle";

const BUTTON: Record<Button, number> = {
  left: BTN_LEFT,
  right: BTN_RIGHT,
  middle: BTN_MIDDLE,
};

const WARMUP_MS = Number(Bun.env.MIMIC_WARMUP ?? "2500");

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const sleep = (ms: number) => Bun.sleep(ms);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export class Hands {
  private readonly pointer: VirtualDevice;
  private readonly wheel: VirtualDevice;
  private readonly keyboard: VirtualDevice;

  x: number;
  y: number;

  constructor(readonly width: number, readonly height: number) {
    this.pointer = new VirtualDevice({
      name: "mimic-pointer",
      keys: [BTN_LEFT, BTN_RIGHT, BTN_MIDDLE],
      abs: [
        { code: ABS_X, min: 0, max: width - 1 },
        { code: ABS_Y, min: 0, max: height - 1 },
      ],
    });
    this.wheel = new VirtualDevice({ name: "mimic-wheel", product: 0x0002, rel: [REL_WHEEL, REL_HWHEEL] });
    this.keyboard = new VirtualDevice({
      name: "mimic-keyboard",
      product: 0x0003,
      keys: KEYBOARD_KEYS,
    });
    this.x = Math.floor(width / 2);
    this.y = Math.floor(height / 2);
  }

  async ready() {
    await sleep(WARMUP_MS);
    this.place(0, 0);
    await sleep(80);
    this.place(this.width - 1, this.height - 1);
    await sleep(80);
    this.place(Math.floor(this.width / 2), Math.floor(this.height / 2));
    await sleep(120);
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
    const x0 = this.x;
    const y0 = this.y;
    const dist = Math.hypot(x - x0, y - y0);
    if (dist < 1.5) {
      this.place(x, y);
      return;
    }
    const total = durationMs ?? Math.min(1200, 120 + dist / 1.6) * rand(0.8, 1.25);
    const steps = Math.max(12, Math.floor(dist / 6));

    const mx = (x0 + x) / 2;
    const my = (y0 + y) / 2;
    const nx = -(y - y0);
    const ny = x - x0;
    const nlen = Math.hypot(nx, ny) || 1;
    const bow = rand(-0.12, 0.12) * dist;
    const cx = mx + (nx / nlen) * bow;
    const cy = my + (ny / nlen) * bow;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t * t * (3 - 2 * t);
      const u = 1 - e;
      let px = u * u * x0 + 2 * u * e * cx + e * e * x;
      let py = u * u * y0 + 2 * u * e * cy + e * e * y;
      if (i < steps) {
        px += rand(-1, 1);
        py += rand(-1, 1);
      }
      this.place(px, py);
      await sleep((total / steps) * rand(0.6, 1.4));
    }
    this.place(x, y);
  }

  private button(code: number, pressed: boolean) {
    this.pointer.emit(EV_KEY, code, pressed ? 1 : 0);
    this.pointer.syn();
  }

  async click(x?: number, y?: number, button: Button = "left", count = 1) {
    if (x !== undefined && y !== undefined) {
      await this.move(x, y);
      await sleep(rand(40, 120));
    }
    const code = BUTTON[button];
    for (let n = 0; n < count; n++) {
      this.button(code, true);
      await sleep(rand(50, 110));
      this.button(code, false);
      if (n + 1 < count) await sleep(rand(60, 130));
    }
  }

  async drag(x1: number, y1: number, x2: number, y2: number, button: Button = "left") {
    const code = BUTTON[button];
    await this.move(x1, y1);
    await sleep(rand(50, 150));
    this.button(code, true);
    await sleep(rand(80, 180));
    await this.move(x2, y2);
    await sleep(rand(50, 150));
    this.button(code, false);
  }

  async scroll(amount: number) {
    const step = amount > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(amount); i++) {
      this.wheel.emit(EV_REL, REL_WHEEL, step);
      this.wheel.syn();
      await sleep(rand(40, 120));
    }
  }

  private async tap(code: number, mods: number[] = []) {
    for (const mod of mods) this.keyboard.emit(EV_KEY, mod, 1);
    if (mods.length) this.keyboard.syn();
    this.keyboard.emit(EV_KEY, code, 1);
    this.keyboard.syn();
    await sleep(rand(12, 45));
    this.keyboard.emit(EV_KEY, code, 0);
    this.keyboard.syn();
    for (const mod of [...mods].reverse()) this.keyboard.emit(EV_KEY, mod, 0);
    if (mods.length) this.keyboard.syn();
  }

  async type(text: string) {
    for (const ch of text) {
      const stroke = CHARS.get(ch);
      if (!stroke) continue;
      await this.tap(stroke.code, stroke.shift ? [KEY.LEFTSHIFT] : []);
      await sleep(rand(30, 120));
    }
  }

  async key(combo: string) {
    const names = combo.toLowerCase().replace(/\+/g, " ").split(/\s+/).filter(Boolean);
    const codes = names.map(resolveKey);
    const last = codes.pop();
    if (last === undefined) return;
    await this.tap(last, codes);
  }

  async paste(text: string) {
    await Bun.spawn(["wl-copy", text]).exited;
    await sleep(100);
    await this.key("ctrl+v");
  }

  home() {
    this.place(Math.floor(this.width / 2), Math.floor(this.height / 2));
  }

  close() {
    this.pointer.close();
    this.wheel.close();
    this.keyboard.close();
  }
}
