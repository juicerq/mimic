import os
import socket
import subprocess
import sys
import time

from mimic import protocol


def _connect():
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.connect(protocol.SOCKET_PATH)
    return s


def is_running():
    if not os.path.exists(protocol.SOCKET_PATH):
        return False
    try:
        s = _connect()
        protocol.send(s, {"action": "ping"})
        resp = protocol.recv(s)
        s.close()
        return bool(resp and resp.get("ok"))
    except OSError:
        return False


def start_daemon(timeout=12.0):
    subprocess.Popen(
        [sys.executable, "-m", "mimic", "_serve"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    deadline = time.time() + timeout
    while time.time() < deadline:
        if is_running():
            return True
        time.sleep(0.1)
    return False


def call(action, dry=False, autostart=True, **args):
    if autostart and not is_running():
        if not start_daemon():
            raise RuntimeError("não consegui iniciar o daemon mimic")
    s = _connect()
    protocol.send(s, {"action": action, "args": args, "dry": dry})
    resp = protocol.recv(s)
    s.close()
    if resp is None:
        raise RuntimeError("sem resposta do daemon")
    if not resp.get("ok"):
        raise RuntimeError(resp.get("error", "erro desconhecido"))
    return resp.get("result")
