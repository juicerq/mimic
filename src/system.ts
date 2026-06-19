import { screenSize, screenshotTool } from "./desktop.ts";
import { uinputWritable } from "./uinput.ts";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  critical: boolean;
  hint?: string;
}

function inspect(): Check[] {
  const session = Bun.env.XDG_SESSION_TYPE ?? "unknown";
  const tool = screenshotTool();
  const clipboard = Bun.which("wl-copy");
  const { width, height } = screenSize();

  return [
    { name: "wayland session", ok: session === "wayland", detail: session, critical: false,
      hint: "mimic is tuned for Wayland; X11 is untested" },
    { name: "uinput writable", ok: uinputWritable(), detail: "/dev/uinput", critical: true,
      hint: "run: mimic setup" },
    { name: "screenshot tool", ok: tool !== null, detail: tool ?? "none", critical: false,
      hint: "install spectacle, grim or gnome-screenshot" },
    { name: "clipboard paste", ok: clipboard !== null, detail: clipboard ?? "none", critical: false,
      hint: "install wl-clipboard for `mimic paste`" },
    { name: "screen geometry", ok: true, detail: `${width}x${height}`, critical: false },
  ];
}

export function diagnose(): boolean {
  for (const check of inspect()) {
    const mark = check.ok ? "✓" : check.critical ? "✗" : "!";
    console.log(`  ${mark}  ${check.name.padEnd(18)} ${check.detail}`);
    if (!check.ok && check.hint) console.log(`         ↳ ${check.hint}`);
  }
  const ready = inspect().filter((check) => check.critical).every((check) => check.ok);
  console.log(ready ? "\nmimic is ready." : "\nmimic is not ready — fix the marks above.");
  return ready;
}

const UDEV_PATH = "/etc/udev/rules.d/99-mimic-uinput.rules";
const UDEV_RULE = 'KERNEL=="uinput", MODE="0660", GROUP="input", OPTIONS+="static_node=uinput"\n';
const MODULES_PATH = "/etc/modules-load.d/uinput.conf";

async function sudo(command: string[], stdin?: Uint8Array): Promise<boolean> {
  const proc = Bun.spawn(["sudo", ...command], {
    stdin: stdin ?? "inherit",
    stdout: "ignore",
    stderr: "inherit",
  });
  return (await proc.exited) === 0;
}

export async function setup(): Promise<void> {
  if (uinputWritable()) {
    console.log("uinput is already accessible — nothing to do.\n");
    diagnose();
    return;
  }

  const user = Bun.env.USER ?? Bun.env.LOGNAME ?? "";
  console.log("mimic setup will, using sudo:");
  console.log("  • load the uinput kernel module now and on every boot");
  console.log("  • install a udev rule giving the 'input' group access to /dev/uinput");
  console.log(`  • add ${user} to the 'input' group\n`);

  const steps =
    (await sudo(["modprobe", "uinput"])) &&
    (await sudo(["tee", MODULES_PATH], Buffer.from("uinput\n"))) &&
    (await sudo(["tee", UDEV_PATH], Buffer.from(UDEV_RULE))) &&
    (await sudo(["usermod", "-aG", "input", user])) &&
    (await sudo(["udevadm", "control", "--reload-rules"])) &&
    (await sudo(["udevadm", "trigger", "--subsystem-match=misc", "--action=add"]));

  if (!steps) {
    console.error("\nsetup failed — check the output above.");
    process.exit(1);
  }

  console.log("\nDone. Log out and back in for the group change to apply,");
  console.log("then run `mimic doctor` to confirm.");
}
