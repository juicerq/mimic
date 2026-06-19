import argparse
import json
import os
import sys

from mimic import client


def build_parser():
    p = argparse.ArgumentParser(
        prog="mimic",
        description="Controle humano do PC (mouse/teclado/tela) para agents — KDE Wayland via uinput.",
    )
    p.add_argument("--dry-run", action="store_true",
                   help="não executa nada, só registra a ação no log")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("shot", help="captura a tela e imprime o caminho do PNG")
    s.add_argument("path", nargs="?", default="/tmp/mimic-shot.png")

    s = sub.add_parser("move", help="move o cursor até x y (movimento humanizado)")
    s.add_argument("x", type=int)
    s.add_argument("y", type=int)

    s = sub.add_parser("click", help="clica; se passar x y, move antes")
    s.add_argument("x", type=int, nargs="?")
    s.add_argument("y", type=int, nargs="?")
    s.add_argument("-b", "--button", default="left",
                   choices=["left", "right", "middle"])
    s.add_argument("-n", "--count", type=int, default=1)

    s = sub.add_parser("dblclick", help="duplo clique (move antes se passar x y)")
    s.add_argument("x", type=int, nargs="?")
    s.add_argument("y", type=int, nargs="?")

    s = sub.add_parser("drag", help="arrasta de x1 y1 até x2 y2")
    s.add_argument("x1", type=int)
    s.add_argument("y1", type=int)
    s.add_argument("x2", type=int)
    s.add_argument("y2", type=int)
    s.add_argument("-b", "--button", default="left",
                   choices=["left", "right", "middle"])

    s = sub.add_parser("scroll", help="rola a roda (positivo sobe, negativo desce)")
    s.add_argument("amount", type=int)

    s = sub.add_parser("type", help="digita texto (layout US, ASCII)")
    s.add_argument("text")

    s = sub.add_parser("paste", help="cola texto via clipboard (acentos/unicode ok)")
    s.add_argument("text")

    s = sub.add_parser("key", help="tecla ou combo: 'enter', 'ctrl+c', 'alt+tab'")
    s.add_argument("combo")

    sub.add_parser("where", help="imprime a posição atual do cursor (x y)")
    sub.add_parser("geometry", help="imprime a resolução (w h)")

    s = sub.add_parser("run", help="executa uma lista JSON de ações (arquivo ou '-' p/ stdin)")
    s.add_argument("file", nargs="?", default="-")

    s = sub.add_parser("daemon", help="controla o daemon")
    s.add_argument("op", choices=["start", "stop", "status", "restart", "log"])

    sub.add_parser("_serve")
    return p


def _abspath(p):
    return os.path.abspath(os.path.expanduser(p))


def _run_script(file, dry):
    raw = sys.stdin.read() if file == "-" else open(file).read()
    for a in json.loads(raw):
        action = dict(a)
        name = action.pop("action")
        if name == "shot" and "path" in action:
            action["path"] = _abspath(action["path"])
        res = client.call(name, dry=dry, **action)
        print(json.dumps({"action": name, "result": res}))


def _daemon_cmd(op):
    from mimic import protocol
    if op == "status":
        print("rodando" if client.is_running() else "parado")
    elif op == "start":
        print("já rodando" if client.is_running()
              else ("iniciado" if client.start_daemon() else "falhou"))
    elif op == "stop":
        if client.is_running():
            try:
                client.call("shutdown", autostart=False)
            except Exception:
                pass
            print("parado")
        else:
            print("não estava rodando")
    elif op == "restart":
        _daemon_cmd("stop")
        _daemon_cmd("start")
    elif op == "log":
        if os.path.exists(protocol.LOG_PATH):
            with open(protocol.LOG_PATH) as f:
                sys.stdout.write(f.read())
        else:
            print("(sem log ainda)")


def main(argv=None):
    args = build_parser().parse_args(argv)
    cmd = args.cmd

    if cmd == "_serve":
        from mimic import daemon
        daemon.serve(dry_global=args.dry_run)
        return
    if cmd == "daemon":
        return _daemon_cmd(args.op)

    dry = args.dry_run
    if cmd == "shot":
        print(client.call("shot", path=_abspath(args.path), dry=dry))
    elif cmd == "move":
        client.call("move", x=args.x, y=args.y, dry=dry)
    elif cmd == "click":
        client.call("click", x=args.x, y=args.y,
                    button=args.button, count=args.count, dry=dry)
    elif cmd == "dblclick":
        client.call("click", x=args.x, y=args.y, count=2, dry=dry)
    elif cmd == "drag":
        client.call("drag", x1=args.x1, y1=args.y1, x2=args.x2, y2=args.y2,
                    button=args.button, dry=dry)
    elif cmd == "scroll":
        client.call("scroll", amount=args.amount, dry=dry)
    elif cmd == "type":
        client.call("type", text=args.text, dry=dry)
    elif cmd == "paste":
        client.call("paste", text=args.text, dry=dry)
    elif cmd == "key":
        client.call("key", combo=args.combo, dry=dry)
    elif cmd == "where":
        print(*client.call("where"))
    elif cmd == "geometry":
        print(*client.call("geometry"))
    elif cmd == "run":
        _run_script(args.file, dry)
