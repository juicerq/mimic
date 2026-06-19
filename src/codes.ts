export const EV_SYN = 0x00;
export const EV_KEY = 0x01;
export const EV_REL = 0x02;
export const EV_ABS = 0x03;

export const SYN_REPORT = 0x00;

export const BTN_LEFT = 0x110;
export const BTN_RIGHT = 0x111;
export const BTN_MIDDLE = 0x112;

export const ABS_X = 0x00;
export const ABS_Y = 0x01;

export const REL_WHEEL = 0x08;
export const REL_HWHEEL = 0x06;

export const KEY = {
  ESC: 1, BACKSPACE: 14, TAB: 15, ENTER: 28, SPACE: 57, CAPSLOCK: 58,
  LEFTCTRL: 29, RIGHTCTRL: 97, LEFTSHIFT: 42, RIGHTSHIFT: 54,
  LEFTALT: 56, RIGHTALT: 100, LEFTMETA: 125, RIGHTMETA: 126,
  MINUS: 12, EQUAL: 13, LEFTBRACE: 26, RIGHTBRACE: 27, SEMICOLON: 39,
  APOSTROPHE: 40, GRAVE: 41, BACKSLASH: 43, COMMA: 51, DOT: 52, SLASH: 53,
  UP: 103, DOWN: 108, LEFT: 105, RIGHT: 106, HOME: 102, END: 107,
  PAGEUP: 104, PAGEDOWN: 109, INSERT: 110, DELETE: 111,
  A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35, I: 23, J: 36,
  K: 37, L: 38, M: 50, N: 49, O: 24, P: 25, Q: 16, R: 19, S: 31, T: 20,
  U: 22, V: 47, W: 17, X: 45, Y: 21, Z: 44,
  N0: 11, N1: 2, N2: 3, N3: 4, N4: 5, N5: 6, N6: 7, N7: 8, N8: 9, N9: 10,
  F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64,
  F7: 65, F8: 66, F9: 67, F10: 68, F11: 87, F12: 88,
} as const;

type KeyName = keyof typeof KEY;

export interface Stroke {
  code: number;
  shift: boolean;
}

const CHARS = new Map<string, Stroke>();
const press = (char: string, code: number, shift = false) => CHARS.set(char, { code, shift });

for (const lower of "abcdefghijklmnopqrstuvwxyz") {
  const code = KEY[lower.toUpperCase() as KeyName];
  press(lower, code);
  press(lower.toUpperCase(), code, true);
}

const SHIFTED_DIGITS = ")!@#$%^&*(";
for (let d = 0; d <= 9; d++) {
  const code = KEY[`N${d}` as KeyName];
  press(String(d), code);
  press(SHIFTED_DIGITS[d], code, true);
}

const SYMBOLS: [base: string, key: KeyName, shifted: string][] = [
  ["-", "MINUS", "_"], ["=", "EQUAL", "+"], ["[", "LEFTBRACE", "{"],
  ["]", "RIGHTBRACE", "}"], [";", "SEMICOLON", ":"], ["'", "APOSTROPHE", '"'],
  ["`", "GRAVE", "~"], ["\\", "BACKSLASH", "|"], [",", "COMMA", "<"],
  [".", "DOT", ">"], ["/", "SLASH", "?"],
];
for (const [base, key, shifted] of SYMBOLS) {
  press(base, KEY[key]);
  press(shifted, KEY[key], true);
}
press(" ", KEY.SPACE);
press("\t", KEY.TAB);
press("\n", KEY.ENTER);

const NAMED: Record<string, number> = {
  ctrl: KEY.LEFTCTRL, control: KEY.LEFTCTRL,
  shift: KEY.LEFTSHIFT,
  alt: KEY.LEFTALT, option: KEY.LEFTALT,
  meta: KEY.LEFTMETA, cmd: KEY.LEFTMETA, command: KEY.LEFTMETA, super: KEY.LEFTMETA, win: KEY.LEFTMETA,
  enter: KEY.ENTER, return: KEY.ENTER,
  esc: KEY.ESC, escape: KEY.ESC,
  tab: KEY.TAB, space: KEY.SPACE,
  backspace: KEY.BACKSPACE, bksp: KEY.BACKSPACE,
  delete: KEY.DELETE, del: KEY.DELETE, insert: KEY.INSERT, ins: KEY.INSERT,
  home: KEY.HOME, end: KEY.END,
  pageup: KEY.PAGEUP, pgup: KEY.PAGEUP, pagedown: KEY.PAGEDOWN, pgdn: KEY.PAGEDOWN,
  up: KEY.UP, down: KEY.DOWN, left: KEY.LEFT, right: KEY.RIGHT,
  capslock: KEY.CAPSLOCK,
};
for (let f = 1; f <= 12; f++) NAMED[`f${f}`] = KEY[`F${f}` as KeyName];

export function resolveKey(name: string): number {
  const lookup = name.toLowerCase();
  if (lookup in NAMED) return NAMED[lookup];
  if (name.length === 1) {
    const stroke = CHARS.get(name);
    if (stroke) return stroke.code;
  }
  throw new Error(`unknown key: ${name}`);
}

export const KEYBOARD_KEYS = [
  ...new Set([
    ...Object.values(KEY),
    ...[...CHARS.values()].map((stroke) => stroke.code),
    ...Object.values(NAMED),
  ]),
];

export { CHARS };
