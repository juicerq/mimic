import { readdirSync } from "node:fs";
import { ABS_X, ABS_Y, BTN_LEFT, EV_ABS, EV_KEY, EV_REL, KEY, REL_WHEEL } from "./codes.ts";
import { Hands } from "./hands.ts";
import {
  close as closeFd,
  ioctlChecked,
  ioctlPtrChecked,
  O_NONBLOCK,
  O_RDONLY,
  open,
  readFd,
  SysError,
} from "./sys.ts";

const EVENT_SIZE = 24;
const NAME_LEN = 256;
const INPUT_DIR = "/dev/input";
const REQUIRED = ["mimic-pointer", "mimic-wheel", "mimic-keyboard"] as const;

const EVIOCGRAB = 0x40044590;
const eviocgname = (len: number) => ((2 << 30) | (len << 16) | (0x45 << 8) | 0x06) >>> 0;

const TEST_WIDTH = 1920;
const TEST_HEIGHT = 1080;

const DISCOVER_TIMEOUT_MS = 3000;
const DISCOVER_POLL_MS = 100;
const SETTLE_MS = 120;

const sleep = (ms: number) => Bun.sleep(ms);

export interface InputEvent {
  type: number;
  code: number;
  value: number;
}

export function decodeEvents(buffer: Buffer, bytes: number): InputEvent[] {
  const events: InputEvent[] = [];
  for (let off = 0; off + EVENT_SIZE <= bytes; off += EVENT_SIZE) {
    events.push({
      type: buffer.readUInt16LE(off + 16),
      code: buffer.readUInt16LE(off + 18),
      value: buffer.readInt32LE(off + 20),
    });
  }
  return events;
}

export function lastAbs(events: InputEvent[], axis: number): number | null {
  let value: number | null = null;
  for (const event of events) {
    if (event.type === EV_ABS && event.code === axis) value = event.value;
  }
  return value;
}

export function countKey(events: InputEvent[], code: number, value: number): number {
  return events.filter((event) => event.type === EV_KEY && event.code === code && event.value === value).length;
}

export function countRel(events: InputEvent[], code: number, value: number): number {
  return events.filter((event) => event.type === EV_REL && event.code === code && event.value === value).length;
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

function checkPosition(events: InputEvent[], x: number, y: number): Check {
  const ax = lastAbs(events, ABS_X);
  const ay = lastAbs(events, ABS_Y);
  const ok = ax === x && ay === y;
  return { name: "pointer move", ok, detail: ok ? `landed at ${x},${y}` : `expected ${x},${y}, got ${ax},${ay}` };
}

function checkButton(events: InputEvent[], code: number): Check {
  const down = countKey(events, code, 1);
  const up = countKey(events, code, 0);
  const ok = down >= 1 && up >= 1;
  return { name: "left click", ok, detail: ok ? "press and release" : `down=${down} up=${up}` };
}

function checkScroll(events: InputEvent[], step: number, notches: number): Check {
  const seen = countRel(events, REL_WHEEL, step);
  const ok = seen === notches;
  return { name: "scroll", ok, detail: ok ? `${notches} notches` : `expected ${notches}, got ${seen}` };
}

function checkTyped(events: InputEvent[], codes: number[]): Check {
  const missing = codes.filter((code) => countKey(events, code, 1) < 1 || countKey(events, code, 0) < 1);
  const ok = missing.length === 0;
  return { name: "keyboard type", ok, detail: ok ? `${codes.length} keys` : `missing codes ${missing.join(",")}` };
}

function deviceName(fd: number): string {
  const buffer = Buffer.alloc(NAME_LEN);
  ioctlPtrChecked(fd, eviocgname(NAME_LEN), buffer, "EVIOCGNAME");
  const end = buffer.indexOf(0);
  return buffer.toString("utf8", 0, end < 0 ? buffer.length : end);
}

function findEvent(name: string): string | null {
  let denied = false;
  for (const entry of readdirSync(INPUT_DIR)) {
    if (!/^event\d+$/.test(entry)) continue;
    const path = `${INPUT_DIR}/${entry}`;
    let fd: number;
    try {
      fd = open(path, O_RDONLY | O_NONBLOCK);
    } catch (e) {
      if (e instanceof SysError && e.code === "EACCES") denied = true;
      continue;
    }
    try {
      if (deviceName(fd) === name) return path;
    } finally {
      closeFd(fd);
    }
  }
  if (denied) {
    throw new Error(
      "mimic: selftest needs read access to /dev/input/event* — run with sudo, or 'sudo usermod -aG input $USER' and re-login",
    );
  }
  return null;
}

class EventReader {
  private readonly fd: number;
  private readonly buffer = Buffer.alloc(EVENT_SIZE * 256);

  constructor(path: string) {
    this.fd = open(path, O_RDONLY | O_NONBLOCK);
  }

  grab() {
    ioctlChecked(this.fd, EVIOCGRAB, 1, "EVIOCGRAB");
  }

  drain(): InputEvent[] {
    const events: InputEvent[] = [];
    for (;;) {
      const n = readFd(this.fd, this.buffer);
      if (n <= 0) break;
      events.push(...decodeEvents(this.buffer, n));
      if (n < this.buffer.byteLength) break;
    }
    return events;
  }

  close() {
    closeFd(this.fd);
  }
}

async function locate(name: string): Promise<EventReader> {
  const deadline = Date.now() + DISCOVER_TIMEOUT_MS;
  for (;;) {
    const path = findEvent(name);
    if (path) return new EventReader(path);
    if (Date.now() >= deadline) {
      throw new Error(`mimic: selftest could not find virtual device '${name}'`);
    }
    await sleep(DISCOVER_POLL_MS);
  }
}

function report(checks: Check[]): boolean {
  let passed = true;
  for (const check of checks) {
    const mark = check.ok ? "✓" : "✗";
    console.log(`  ${mark}  ${check.name.padEnd(16)} ${check.detail}`);
    if (!check.ok) passed = false;
  }
  console.log(
    passed ? "\nmimic selftest passed — events reached the kernel; real input untouched." : "\nmimic selftest failed.",
  );
  return passed;
}

export async function selftest(): Promise<boolean> {
  const width = TEST_WIDTH;
  const height = TEST_HEIGHT;
  const hands = new Hands(width, height, { config: { minSteps: 6 } });
  const readers: EventReader[] = [];

  try {
    const [pointer, wheel, keyboard] = await Promise.all(REQUIRED.map((name) => locate(name)));
    readers.push(pointer, wheel, keyboard);

    for (const reader of readers) reader.grab();
    await sleep(SETTLE_MS);
    for (const reader of readers) reader.drain();

    const checks: Check[] = [];

    const tx = Math.min(width - 1, Math.floor(width / 2) + 40);
    const ty = Math.min(height - 1, Math.floor(height / 2) + 30);
    await hands.move(tx, ty);
    await sleep(SETTLE_MS);
    checks.push(checkPosition(pointer.drain(), tx, ty));

    await hands.click(undefined, undefined, "left");
    await sleep(SETTLE_MS);
    checks.push(checkButton(pointer.drain(), BTN_LEFT));

    await hands.scroll(-3);
    await sleep(SETTLE_MS);
    checks.push(checkScroll(wheel.drain(), -1, 3));

    await hands.type("ab");
    await sleep(SETTLE_MS);
    checks.push(checkTyped(keyboard.drain(), [KEY.A, KEY.B]));

    return report(checks);
  } finally {
    for (const reader of readers) reader.close();
    hands.close();
  }
}
