import json
import os

_RUNTIME = os.environ.get("XDG_RUNTIME_DIR") or "/tmp"
_STATE = os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state")

SOCKET_PATH = os.path.join(_RUNTIME, "mimic.sock")
LOG_PATH = os.path.join(_STATE, "mimic", "actions.log")


def send(conn, obj):
    conn.sendall((json.dumps(obj) + "\n").encode())


def recv(conn):
    buf = b""
    while not buf.endswith(b"\n"):
        chunk = conn.recv(4096)
        if not chunk:
            break
        buf += chunk
    if not buf:
        return None
    return json.loads(buf.decode())
