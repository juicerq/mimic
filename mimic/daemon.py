import datetime
import os
import signal
import socket

from mimic import geometry, protocol, screen
from mimic.devices import Hands


def _log(line):
    os.makedirs(os.path.dirname(protocol.LOG_PATH), exist_ok=True)
    stamp = datetime.datetime.now().isoformat(timespec="seconds")
    with open(protocol.LOG_PATH, "a") as f:
        f.write(f"{stamp} {line}\n")


def _dispatch(hands, action, args):
    if action == "shot":
        return screen.capture(args.get("path", "/tmp/mimic-shot.png"))
    if action == "move":
        hands.move(args["x"], args["y"])
        return [hands.x, hands.y]
    if action == "click":
        hands.click(args.get("x"), args.get("y"),
                    button=args.get("button", "left"),
                    count=int(args.get("count", 1)))
        return [hands.x, hands.y]
    if action == "drag":
        hands.drag(args["x1"], args["y1"], args["x2"], args["y2"],
                   button=args.get("button", "left"))
        return [hands.x, hands.y]
    if action == "scroll":
        hands.scroll(int(args["amount"]))
        return "ok"
    if action == "type":
        hands.type_text(args["text"])
        return "ok"
    if action == "paste":
        hands.paste_text(args["text"])
        return "ok"
    if action == "key":
        hands.key(args["combo"])
        return "ok"
    if action == "home":
        hands.home()
        return [hands.x, hands.y]
    if action == "where":
        return [hands.x, hands.y]
    if action == "geometry":
        return [hands.w, hands.h]
    if action == "ping":
        return "pong"
    raise ValueError(f"ação desconhecida: {action}")


def serve(dry_global=False):
    if os.path.exists(protocol.SOCKET_PATH):
        os.unlink(protocol.SOCKET_PATH)
    w, h = geometry.screen_size()
    hands = Hands(w, h)
    _log(f"start geometry={w}x{h} dry={dry_global}")

    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(protocol.SOCKET_PATH)
    srv.listen(8)

    def shutdown(*_):
        _log("stop")
        try:
            srv.close()
        finally:
            hands.close()
            if os.path.exists(protocol.SOCKET_PATH):
                os.unlink(protocol.SOCKET_PATH)
            os._exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    while True:
        conn, _ = srv.accept()
        try:
            req = protocol.recv(conn)
            if req is None:
                continue
            action = req.get("action")
            args = req.get("args") or {}
            dry = bool(req.get("dry")) or dry_global

            if action == "shutdown":
                protocol.send(conn, {"ok": True, "result": "bye"})
                conn.close()
                shutdown()

            if dry:
                _log(f"DRY {action} {args}")
                protocol.send(conn, {"ok": True, "result": "dry-run"})
                continue
            try:
                result = _dispatch(hands, action, args)
                _log(f"{action} {args} -> {result}")
                protocol.send(conn, {"ok": True, "result": result})
            except Exception as ex:
                _log(f"ERROR {action} {args}: {ex}")
                protocol.send(conn, {"ok": False, "error": str(ex)})
        finally:
            conn.close()
