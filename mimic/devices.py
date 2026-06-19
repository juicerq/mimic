import math
import os
import random
import subprocess
import time

from evdev import UInput, AbsInfo
from evdev import ecodes as e

from mimic import keymap

WARMUP = float(os.environ.get("MIMIC_WARMUP", "2.5"))

_BUTTONS = {"left": e.BTN_LEFT, "right": e.BTN_RIGHT, "middle": e.BTN_MIDDLE}


class Hands:
    def __init__(self, width, height):
        self.w = width
        self.h = height
        self.pointer = UInput(
            {
                e.EV_KEY: list(_BUTTONS.values()),
                e.EV_ABS: [
                    (e.ABS_X, AbsInfo(0, 0, width - 1, 0, 0, 0)),
                    (e.ABS_Y, AbsInfo(0, 0, height - 1, 0, 0, 0)),
                ],
            },
            name="mimic-pointer", vendor=0x1D6B, product=0x0001, version=1,
        )
        self.wheel = UInput(
            {e.EV_REL: [e.REL_WHEEL, e.REL_HWHEEL]},
            name="mimic-wheel", vendor=0x1D6B, product=0x0002, version=1,
        )
        self.kbd = UInput(
            {e.EV_KEY: keymap.ALL_KEY_CODES},
            name="mimic-keyboard", vendor=0x1D6B, product=0x0003, version=1,
        )
        time.sleep(WARMUP)
        self.x = width // 2
        self.y = height // 2
        self._place(self.x, self.y)

    def _place(self, x, y):
        x = max(0, min(self.w - 1, int(round(x))))
        y = max(0, min(self.h - 1, int(round(y))))
        self.pointer.write(e.EV_ABS, e.ABS_X, x)
        self.pointer.write(e.EV_ABS, e.ABS_Y, y)
        self.pointer.syn()
        self.x, self.y = x, y

    def move(self, x, y, duration=None):
        x0, y0 = self.x, self.y
        dist = math.hypot(x - x0, y - y0)
        if dist < 1.5:
            self._place(x, y)
            return
        if duration is None:
            duration = min(1.2, 0.12 + dist / 1600.0) * random.uniform(0.8, 1.25)
        steps = max(12, int(dist / 6))
        mx, my = (x0 + x) / 2, (y0 + y) / 2
        nx, ny = -(y - y0), (x - x0)
        nlen = math.hypot(nx, ny) or 1.0
        bow = random.uniform(-0.12, 0.12) * dist
        cx, cy = mx + nx / nlen * bow, my + ny / nlen * bow
        for i in range(1, steps + 1):
            t = i / steps
            te = t * t * (3 - 2 * t)
            u = 1 - te
            px = u * u * x0 + 2 * u * te * cx + te * te * x
            py = u * u * y0 + 2 * u * te * cy + te * te * y
            if i < steps:
                px += random.uniform(-1.0, 1.0)
                py += random.uniform(-1.0, 1.0)
            self._place(px, py)
            time.sleep(duration / steps * random.uniform(0.6, 1.4))
        self._place(x, y)

    def _button(self, code, value):
        self.pointer.write(e.EV_KEY, code, value)
        self.pointer.syn()

    def click(self, x=None, y=None, button="left", count=1):
        if x is not None and y is not None:
            self.move(x, y)
            time.sleep(random.uniform(0.04, 0.12))
        code = _BUTTONS[button]
        for n in range(count):
            self._button(code, 1)
            time.sleep(random.uniform(0.05, 0.11))
            self._button(code, 0)
            if n + 1 < count:
                time.sleep(random.uniform(0.06, 0.13))

    def drag(self, x1, y1, x2, y2, button="left"):
        code = _BUTTONS[button]
        self.move(x1, y1)
        time.sleep(random.uniform(0.05, 0.15))
        self._button(code, 1)
        time.sleep(random.uniform(0.08, 0.18))
        self.move(x2, y2)
        time.sleep(random.uniform(0.05, 0.15))
        self._button(code, 0)

    def scroll(self, amount):
        step = 1 if amount > 0 else -1
        for _ in range(abs(int(amount))):
            self.wheel.write(e.EV_REL, e.REL_WHEEL, step)
            self.wheel.syn()
            time.sleep(random.uniform(0.04, 0.12))

    def _tap(self, code, mods=()):
        for m in mods:
            self.kbd.write(e.EV_KEY, m, 1)
        self.kbd.syn()
        self.kbd.write(e.EV_KEY, code, 1)
        self.kbd.syn()
        time.sleep(random.uniform(0.012, 0.045))
        self.kbd.write(e.EV_KEY, code, 0)
        self.kbd.syn()
        for m in reversed(mods):
            self.kbd.write(e.EV_KEY, m, 0)
        self.kbd.syn()

    def type_text(self, text):
        for ch in text:
            entry = keymap.CHARMAP.get(ch)
            if entry is None:
                continue
            code, shift = entry
            self._tap(code, mods=(e.KEY_LEFTSHIFT,) if shift else ())
            time.sleep(random.uniform(0.03, 0.12))

    def key(self, combo):
        names = [p for p in combo.lower().replace("+", " ").split() if p]
        codes = [keymap.resolve(n) for n in names]
        *mods, last = codes
        self._tap(last, mods=mods)

    def paste_text(self, text):
        subprocess.run(["wl-copy", text], check=True)
        time.sleep(0.1)
        self.key("ctrl+v")

    def home(self):
        self._place(self.w // 2, self.h // 2)

    def close(self):
        for dev in (self.pointer, self.wheel, self.kbd):
            try:
                dev.close()
            except Exception:
                pass
