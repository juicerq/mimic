import { selftest } from "./selftest.ts";
import { call, isRunning, LOG_PATH, serve } from "./service.ts";
import { diagnose, setup } from "./system.ts";

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

system
  doctor                      check the machine is ready
  setup                       grant uinput access (sudo, once)
  selftest                    verify input reaches the kernel without moving real devices
  daemon status|stop|log      manage the background daemon

options
  -b, --button <name>         left | right | middle (default left)
  -n, --count <n>             repeat count for click
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

    case "shot":
      console.log(await call("shot", { path: rest[0] }, { dry }));
      return;
    case "move": {
      if (rest.length !== 2) {
        usage("mimic move <x> <y>");
      }
      await call("move", { x: int(rest[0], "x"), y: int(rest[1], "y") }, { dry });
      return;
    }
    case "click": {
      const count = countOption !== undefined ? int(countOption, "count") : 1;
      await call("click", clickArgs(rest, button, count), { dry });
      return;
    }
    case "dblclick": {
      const count = countOption !== undefined ? int(countOption, "count") : 2;
      await call("click", clickArgs(rest, button, count), { dry });
      return;
    }
    case "drag": {
      if (rest.length !== 4) {
        usage("mimic drag <x1> <y1> <x2> <y2>");
      }
      await call(
        "drag",
        { x1: int(rest[0], "x1"), y1: int(rest[1], "y1"), x2: int(rest[2], "x2"), y2: int(rest[3], "y2"), button },
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
