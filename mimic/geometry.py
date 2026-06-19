import os
import re
import subprocess

DEFAULT = (1920, 1080)


def screen_size():
    env = os.environ.get("MIMIC_SCREEN")
    if env and "x" in env:
        w, h = env.lower().split("x", 1)
        return int(w), int(h)
    try:
        out = subprocess.run(
            ["kscreen-doctor", "-o"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        m = re.search(r"Geometry:\s*\d+,\d+\s+(\d+)x(\d+)", out)
        if m:
            return int(m.group(1)), int(m.group(2))
    except Exception:
        pass
    return DEFAULT
