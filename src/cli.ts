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
  type <text...>              type at the keyboard
  paste <text...>             paste via clipboard (any unicode)
  key <combo>                 e.g. ctrl+c, alt+tab, super
  where                       print the pointer position
  geometry                    print the screen size

system
  doctor                      check the machine is ready
  setup                       grant uinput access (sudo, once)
  daemon status|stop|log      manage the background daemon

options
  -b, --button <name>         left | right | middle (default left)
  -n, --count <n>             repeat count for click
      --dry-run               log the action without performing it
  -h, --help                  show this help`;

const argv = Bun.argv.slice(2);

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

function clickArgs(positions: string[], button: string, count: number): Record<string, unknown> {
  const args: Record<string, unknown> = { button, count };
  if (positions.length >= 2) {
    args.x = +positions[0];
    args.y = +positions[1];
  }
  return args;
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
      console.log((await Bun.file(LOG_PATH).text().catch(() => "")) || "(no actions logged yet)");
      return;
    default:
      console.error("usage: mimic daemon status|stop|log");
      process.exit(1);
  }
}

async function main() {
  const help = takeFlag("-h", "--help");
  const dry = takeFlag("--dry-run");
  const button = takeOption("-b", "--button") ?? "left";
  const count = Number(takeOption("-n", "--count") ?? "1");
  const [command, ...rest] = argv;

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

    case "shot":
      console.log(await call("shot", { path: rest[0] }, { dry }));
      return;
    case "move":
      await call("move", { x: +rest[0], y: +rest[1] }, { dry });
      return;
    case "click":
      await call("click", clickArgs(rest, button, count), { dry });
      return;
    case "dblclick":
      await call("click", clickArgs(rest, button, 2), { dry });
      return;
    case "drag":
      await call("drag", { x1: +rest[0], y1: +rest[1], x2: +rest[2], y2: +rest[3], button }, { dry });
      return;
    case "scroll":
      await call("scroll", { amount: +rest[0] }, { dry });
      return;
    case "type":
      await call("type", { text: rest.join(" ") }, { dry });
      return;
    case "paste":
      await call("paste", { text: rest.join(" ") }, { dry });
      return;
    case "key":
      await call("key", { combo: rest[0] }, { dry });
      return;
    case "where":
      console.log((await call("where") as number[]).join(" "));
      return;
    case "geometry":
      console.log((await call("geometry") as number[]).join("x"));
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
