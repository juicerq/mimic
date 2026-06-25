import { find, type Region, screenshot, type View } from "./desktop.ts";
import { selftest } from "./selftest.ts";
import { call, isRunning, LOG_PATH, serve } from "./service.ts";
import { diagnose, setup } from "./system.ts";
import { activateWindow, findWindow, listWindows } from "./window.ts";

const HELP = `mimic — drive your computer like a human

usage
  mimic <command> [args] [--dry-run]

control
  shot [path]                 capture the screen (default /tmp/mimic-shot.png)
  move <x> <y>                glide the pointer there
  click [x y]                 click, optionally moving there first
  dblclick [x y]              double click
  drag <x1> <y1> <x2> <y2>    press, move, release
  scroll <amount>             positive scrolls up, negative down
  type [--dry-run] [--] <text...>   type at the keyboard
  paste [--dry-run] [--] <text...>  paste via clipboard (any unicode)
  key <combo>                 e.g. ctrl+c, alt+tab, super
  where                       print the pointer position
  geometry                    print the screen size

perception
  find <template.png>         print the on-screen center of a matched icon
  window list                 list windows: class, geometry, caption
  window activate <query>     focus the first window matching class or title

system
  doctor                      check the machine is ready
  setup                       grant uinput access (sudo, once)
  selftest                    verify input reaches the kernel without moving real devices
  daemon status|stop|log      manage the background daemon

options
  -b, --button <name>         left | right | middle (default left)
  -n, --count <n>             repeat count for click
      --window <query>        treat move/click/drag coords as fractions (0..1) of that window
      --region <x,y,w,h>      shot: crop to this rectangle
      --zoom <n>              shot: magnify the capture n times
      --grid                  shot: overlay a coordinate grid (in screen coords)
      --threshold <n>         find: min match score, 0..1 (default 0.80)
      --dry-run               log the action without performing it
  -h, --help                  show this help`;

const argv = Bun.argv.slice(2);

export function usage(message: string): never {
  console.error(`usage: ${message}`);
  process.exit(1);
}

export function int(token: string | undefined, name: string): number {
  const value = Number(token);
  if (token === undefined || token === "" || !Number.isFinite(value)) {
    usage(`mimic: <${name}> must be a number`);
  }
  return value;
}

function takeFlag(...names: string[]): boolean {
  for (const name of names) {
    const index = argv.indexOf(name);
    if (index >= 0) {
      argv.splice(index, 1);
      return true;
    }
  }
  return false;
}

function takeOption(...names: string[]): string | undefined {
  for (const name of names) {
    const index = argv.indexOf(name);
    if (index >= 0) return argv.splice(index, 2)[1];
  }
  return undefined;
}

export function parseRegion(s: string): Region | null {
  const parts = s.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

async function toAbsolute(query: string | undefined, positions: string[]): Promise<string[]> {
  if (query === undefined) return positions;
  const win = await findWindow(query);
  return positions.map((p, i) =>
    String(Math.round(i % 2 === 0 ? win.x + Number(p) * win.width : win.y + Number(p) * win.height)),
  );
}

export function clickArgs(positions: string[], button: string, count: number): Record<string, unknown> {
  const args: Record<string, unknown> = { button, count };
  if (positions.length === 1) {
    usage("mimic click [x y] — pass both x and y or neither");
  }
  if (positions.length >= 2) {
    args.x = int(positions[0], "x");
    args.y = int(positions[1], "y");
  }
  return args;
}

function freeText(rest: string[]): { text: string; dry: boolean } {
  let dry = false;
  let tokens = rest;
  if (tokens[0] === "--dry-run") {
    dry = true;
    tokens = tokens.slice(1);
  }
  if (tokens[0] === "--") {
    tokens = tokens.slice(1);
  }
  return { text: tokens.join(" "), dry };
}

async function windowCommand(rest: string[]) {
  switch (rest[0]) {
    case "list":
      for (const win of await listWindows()) {
        const flag = win.active ? "*" : " ";
        console.log(`${flag} ${win.class}\t${win.width}x${win.height}+${win.x}+${win.y}\t${win.caption}`);
      }
      return;
    case "activate": {
      if (!rest[1]) {
        usage("mimic window activate <query>");
      }
      const win = await activateWindow(rest[1]);
      console.log(`activated ${win.class} (${win.caption})`);
      return;
    }
    default:
      usage("mimic window list|activate <query>");
  }
}

async function daemon(sub: string | undefined) {
  switch (sub) {
    case "status":
      console.log((await isRunning()) ? "running" : "stopped");
      return;
    case "stop": {
      let attempts = 0;
      while ((await isRunning()) && attempts++ < 20) {
        await call("shutdown", {}, { autostart: false }).catch(() => {});
        await Bun.sleep(100);
      }
      console.log((await isRunning()) ? "still running" : "stopped");
      return;
    }
    case "log":
      console.log(
        (await Bun.file(LOG_PATH)
          .text()
          .catch(() => "")) || "(no actions logged yet)",
      );
      return;
    default:
      console.error("usage: mimic daemon status|stop|log");
      process.exit(1);
  }
}

async function main() {
  const command = argv[0];

  if (command === "type" || command === "paste") {
    const { text, dry } = freeText(argv.slice(1));
    if (text === "") {
      usage(`mimic ${command} [--dry-run] [--] <text...>`);
    }
    const key = command === "type" ? "type" : "paste";
    await call(key, { text }, { dry });
    return;
  }

  const help = takeFlag("-h", "--help");
  const dry = takeFlag("--dry-run");
  const button = takeOption("-b", "--button") ?? "left";
  const countOption = takeOption("-n", "--count");
  const windowQuery = takeOption("--window");
  const regionOption = takeOption("--region");
  const zoomOption = takeOption("--zoom");
  const grid = takeFlag("--grid");
  const thresholdOption = takeOption("--threshold");
  const [, ...rest] = argv;

  if (help || !command) {
    console.log(HELP);
    return;
  }

  switch (command) {
    case "_serve":
      return serve(dry);
    case "doctor":
      process.exit(diagnose() ? 0 : 1);
      return;
    case "setup":
      return setup();
    case "selftest":
      process.exit((await selftest()) ? 0 : 1);
      return;

    case "shot": {
      const view: View = {};
      if (regionOption !== undefined) {
        const region = parseRegion(regionOption);
        if (!region) usage("mimic shot --region <x,y,w,h>");
        view.region = region;
      }
      if (zoomOption !== undefined) view.zoom = int(zoomOption, "zoom");
      if (grid) view.grid = 100;
      console.log(await screenshot(rest[0] ?? "/tmp/mimic-shot.png", view));
      return;
    }
    case "find": {
      if (!rest[0]) {
        usage("mimic find <template.png>");
      }
      const hit = await find(rest[0], thresholdOption !== undefined ? int(thresholdOption, "threshold") : undefined);
      if (!hit) {
        console.error("mimic: no match");
        process.exit(1);
      }
      console.log(`${hit.x} ${hit.y}`);
      return;
    }
    case "window":
      return windowCommand(rest);
    case "move": {
      const pos = await toAbsolute(windowQuery, rest);
      if (pos.length !== 2) {
        usage(windowQuery ? "mimic move --window <query> <fx> <fy>" : "mimic move <x> <y>");
      }
      await call("move", { x: int(pos[0], "x"), y: int(pos[1], "y") }, { dry });
      return;
    }
    case "click": {
      const count = countOption !== undefined ? int(countOption, "count") : 1;
      await call("click", clickArgs(await toAbsolute(windowQuery, rest), button, count), { dry });
      return;
    }
    case "dblclick": {
      const count = countOption !== undefined ? int(countOption, "count") : 2;
      await call("click", clickArgs(await toAbsolute(windowQuery, rest), button, count), { dry });
      return;
    }
    case "drag": {
      const pos = await toAbsolute(windowQuery, rest);
      if (pos.length !== 4) {
        usage(windowQuery ? "mimic drag --window <query> <fx1> <fy1> <fx2> <fy2>" : "mimic drag <x1> <y1> <x2> <y2>");
      }
      await call(
        "drag",
        { x1: int(pos[0], "x1"), y1: int(pos[1], "y1"), x2: int(pos[2], "x2"), y2: int(pos[3], "y2"), button },
        { dry },
      );
      return;
    }
    case "scroll": {
      if (rest.length !== 1) {
        usage("mimic scroll <amount>");
      }
      await call("scroll", { amount: int(rest[0], "amount") }, { dry });
      return;
    }
    case "key": {
      if (!rest[0]) {
        usage("mimic key <combo>");
      }
      await call("key", { combo: rest[0] }, { dry });
      return;
    }
    case "where":
      console.log(((await call("where")) as number[]).join(" "));
      return;
    case "geometry":
      console.log(((await call("geometry")) as number[]).join("x"));
      return;
    case "daemon":
      return daemon(rest[0]);

    default:
      console.error(`mimic: unknown command '${command}' (try 'mimic --help')`);
      process.exit(1);
  }
}

export async function run() {
  try {
    await main();
  } catch (error) {
    console.error(`mimic: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
