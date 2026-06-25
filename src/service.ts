import { $ } from "bun";
import { screenSize } from "./desktop.ts";
import { type Button, Hands } from "./hands.ts";
import { close as closeFd, flockExclusive, O_APPEND, O_CREAT, O_RDONLY, O_WRONLY, open, write } from "./sys.ts";
import { uinputWritable } from "./uinput.ts";

const runtimeDir = Bun.env.XDG_RUNTIME_DIR ?? "/tmp";
const stateDir = `${Bun.env.XDG_STATE_HOME ?? `${Bun.env.HOME}/.local/state`}/mimic`;

export const SOCKET_PATH = `${runtimeDir}/mimic.sock`;
export const LOG_PATH = `${stateDir}/actions.log`;
export const LOCK_PATH = `${runtimeDir}/mimic.lock`;
export const BOOT_LOG_PATH = `${stateDir}/boot.log`;
export const MAX_REQUEST_BYTES = 1 << 20;

const REQUEST_TIMEOUT_MS = 5000;

export interface Request {
  action: string;
  args?: Record<string, unknown>;
  dry?: boolean;
}

export type Response = { ok: true; result: unknown } | { ok: false; error: string };

export const encode = (message: Request | Response) => `${JSON.stringify(message)}\n`;

function request(req: Request, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let socketRef: { end(): void } | null = null;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socketRef?.end();
      reject(new Error("mimic: request timed out"));
    }, timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    Bun.connect({
      unix: SOCKET_PATH,
      socket: {
        open: (socket) => {
          socketRef = socket;
          socket.write(encode(req));
        },
        data: (socket, chunk) => {
          buffer += chunk.toString();
          const newline = buffer.indexOf("\n");
          if (newline < 0) {
            if (buffer.length > MAX_REQUEST_BYTES) {
              socket.end();
              finish(() => reject(new Error("mimic: response too large")));
            }
            return;
          }
          socket.end();
          const line = buffer.slice(0, newline);
          finish(() => resolve(JSON.parse(line) as Response));
        },
        connectError: (_socket, error) => finish(() => reject(error)),
        error: (_socket, error) => finish(() => reject(error)),
      },
    }).catch((error) => finish(() => reject(error)));
  });
}

export async function isRunning(): Promise<boolean> {
  try {
    return (await request({ action: "ping" })).ok;
  } catch {
    return false;
  }
}

async function autostart(timeoutMs = 12_000): Promise<boolean> {
  await $`mkdir -p ${stateDir}`.quiet();

  const command = [process.execPath, Bun.main, "_serve"];
  Bun.spawn(Bun.which("setsid") ? ["setsid", ...command] : command, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: Bun.file(BOOT_LOG_PATH),
  }).unref();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isRunning()) return true;
    await Bun.sleep(150);
  }
  return false;
}

export interface CallOptions {
  dry?: boolean;
  autostart?: boolean;
  timeoutMs?: number;
}

export async function call(
  action: string,
  args: Record<string, unknown> = {},
  { dry = false, autostart: auto = true, timeoutMs }: CallOptions = {},
): Promise<unknown> {
  if (!(await isRunning())) {
    if (!auto || !(await autostart())) throw new Error("mimic: daemon is not running");
  }
  const response = await request({ action, args, dry }, timeoutMs);
  if (!response.ok) throw new Error(response.error);
  return response.result;
}

async function dispatch(hands: Hands, req: Request): Promise<unknown> {
  const args = req.args ?? {};
  const num = (key: string) => Number(args[key]);
  const opt = (key: string) => (args[key] === undefined ? undefined : Number(args[key]));
  const button = (args.button as Button) ?? "left";

  switch (req.action) {
    case "move":
      await hands.move(num("x"), num("y"));
      return [hands.x, hands.y];
    case "click":
      await hands.click(opt("x"), opt("y"), button, args.count ? Number(args.count) : 1);
      return [hands.x, hands.y];
    case "drag":
      await hands.drag(num("x1"), num("y1"), num("x2"), num("y2"), button);
      return [hands.x, hands.y];
    case "scroll":
      await hands.scroll(num("amount"));
      return "ok";
    case "type":
      return hands.type(String(args.text ?? ""));
    case "paste":
      await hands.paste(String(args.text ?? ""));
      return "ok";
    case "key":
      await hands.key(String(args.combo ?? ""));
      return "ok";
    case "home":
      hands.home();
      return [hands.x, hands.y];
    case "where":
      return [hands.x, hands.y];
    case "geometry":
      return [hands.width, hands.height];
    default:
      throw new Error(`unknown action: ${req.action}`);
  }
}

export async function serve(globalDry = false): Promise<void> {
  const lockFd = open(LOCK_PATH, O_RDONLY | O_CREAT);
  if (!flockExclusive(lockFd)) {
    closeFd(lockFd);
    return;
  }

  if (!uinputWritable()) {
    closeFd(lockFd);
    throw new Error("mimic: /dev/uinput not writable — run 'mimic setup'");
  }

  if (await isRunning()) {
    closeFd(lockFd);
    return;
  }
  await Bun.file(SOCKET_PATH)
    .delete()
    .catch(() => {});

  const { width, height } = screenSize();
  const hands = new Hands(width, height);
  await hands.ready();

  await $`mkdir -p ${stateDir}`.quiet();
  const logFd = open(LOG_PATH, O_WRONLY | O_CREAT | O_APPEND);
  const log = (line: string) => write(logFd, Buffer.from(`${new Date().toISOString()} ${line}\n`, "utf8"));
  log(`start ${width}x${height}${globalDry ? " dry" : ""}`);

  const shutdown = () => {
    log("stop");
    hands.close();
    closeFd(logFd);
    closeFd(lockFd);
    process.exit(0);
  };

  const listen = (): ReturnType<typeof Bun.listen<{ buffer: string }>> =>
    Bun.listen<{ buffer: string }>({
      unix: SOCKET_PATH,
      socket: {
        open: (socket) => {
          socket.data = { buffer: "" };
        },
        data: async (socket, chunk) => {
          socket.data.buffer += chunk.toString();
          if (socket.data.buffer.length > MAX_REQUEST_BYTES) {
            socket.write(encode({ ok: false, error: "mimic: request too large" }));
            socket.end();
            return;
          }
          const newline = socket.data.buffer.indexOf("\n");
          if (newline < 0) return;

          const reply = (response: Response) => {
            socket.write(encode(response));
            socket.end();
          };

          let req: Request;
          try {
            req = JSON.parse(socket.data.buffer.slice(0, newline));
          } catch {
            return reply({ ok: false, error: "malformed request" });
          }

          if (req.action === "ping") return reply({ ok: true, result: "pong" });
          if (req.action === "shutdown") {
            reply({ ok: true, result: "bye" });
            setTimeout(shutdown, 50);
            return;
          }

          if (req.dry || globalDry) {
            log(`dry ${req.action} ${JSON.stringify(req.args ?? {})}`);
            return reply({ ok: true, result: "dry-run" });
          }

          try {
            const result = await dispatch(hands, req);
            log(`${req.action} ${JSON.stringify(req.args ?? {})} -> ${JSON.stringify(result)}`);
            reply({ ok: true, result });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log(`error ${req.action}: ${message}`);
            reply({ ok: false, error: message });
          }
        },
      },
    });

  try {
    listen();
  } catch (error) {
    if (!isAddressInUse(error)) throw error;
    await Bun.file(SOCKET_PATH)
      .delete()
      .catch(() => {});
    listen();
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function isAddressInUse(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return code === "EADDRINUSE" || /address (already )?in use|EADDRINUSE/i.test(error.message);
}
