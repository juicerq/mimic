from evdev import ecodes as e


def _charmap():
    m = {}
    for c in "abcdefghijklmnopqrstuvwxyz":
        code = getattr(e, f"KEY_{c.upper()}")
        m[c] = (code, False)
        m[c.upper()] = (code, True)
    dcodes = {d: getattr(e, f"KEY_{d}") for d in "0123456789"}
    for d, code in dcodes.items():
        m[d] = (code, False)
    for sym, d in zip(")!@#$%^&*(", "0123456789"):
        m[sym] = (dcodes[d], True)
    plain = {
        " ": e.KEY_SPACE, "\n": e.KEY_ENTER, "\t": e.KEY_TAB,
        "-": e.KEY_MINUS, "=": e.KEY_EQUAL, "[": e.KEY_LEFTBRACE,
        "]": e.KEY_RIGHTBRACE, "\\": e.KEY_BACKSLASH, ";": e.KEY_SEMICOLON,
        "'": e.KEY_APOSTROPHE, "`": e.KEY_GRAVE, ",": e.KEY_COMMA,
        ".": e.KEY_DOT, "/": e.KEY_SLASH,
    }
    for ch, code in plain.items():
        m[ch] = (code, False)
    shifted = {
        "_": e.KEY_MINUS, "+": e.KEY_EQUAL, "{": e.KEY_LEFTBRACE,
        "}": e.KEY_RIGHTBRACE, "|": e.KEY_BACKSLASH, ":": e.KEY_SEMICOLON,
        '"': e.KEY_APOSTROPHE, "~": e.KEY_GRAVE, "<": e.KEY_COMMA,
        ">": e.KEY_DOT, "?": e.KEY_SLASH,
    }
    for ch, code in shifted.items():
        m[ch] = (code, True)
    return m


CHARMAP = _charmap()

KEYS = {
    "enter": e.KEY_ENTER, "return": e.KEY_ENTER, "esc": e.KEY_ESC,
    "escape": e.KEY_ESC, "tab": e.KEY_TAB, "space": e.KEY_SPACE,
    "backspace": e.KEY_BACKSPACE, "delete": e.KEY_DELETE, "del": e.KEY_DELETE,
    "insert": e.KEY_INSERT, "up": e.KEY_UP, "down": e.KEY_DOWN,
    "left": e.KEY_LEFT, "right": e.KEY_RIGHT, "home": e.KEY_HOME,
    "end": e.KEY_END, "pageup": e.KEY_PAGEUP, "pagedown": e.KEY_PAGEDOWN,
    "ctrl": e.KEY_LEFTCTRL, "control": e.KEY_LEFTCTRL, "alt": e.KEY_LEFTALT,
    "altgr": e.KEY_RIGHTALT, "shift": e.KEY_LEFTSHIFT, "super": e.KEY_LEFTMETA,
    "meta": e.KEY_LEFTMETA, "win": e.KEY_LEFTMETA, "capslock": e.KEY_CAPSLOCK,
}
for _i in range(1, 13):
    KEYS[f"f{_i}"] = getattr(e, f"KEY_F{_i}")

ALL_KEY_CODES = sorted(set(KEYS.values()) | {c for c, _ in CHARMAP.values()})


def resolve(name):
    if name in KEYS:
        return KEYS[name]
    if len(name) == 1 and name in CHARMAP:
        return CHARMAP[name][0]
    raise KeyError(f"tecla desconhecida: {name}")
