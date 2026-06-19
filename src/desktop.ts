export interface Size {
  width: number;
  height: number;
}

const BACKENDS: { tool: string; args: (path: string) => string[] }[] = [
  { tool: "spectacle", args: (path) => ["-b", "-n", "-f", "-o", path] },
  { tool: "grim", args: (path) => [path] },
  { tool: "gnome-screenshot", args: (path) => ["-f", path] },
];

export function screenshotTool(): string | null {
  return BACKENDS.find((backend) => Bun.which(backend.tool))?.tool ?? null;
}

export async function screenshot(path: string): Promise<string> {
  for (const backend of BACKENDS) {
    if (!Bun.which(backend.tool)) continue;
    const proc = Bun.spawn([backend.tool, ...backend.args(path)], { stdout: "ignore", stderr: "ignore" });
    if ((await proc.exited) === 0) return path;
  }
  throw new Error("mimic: no screenshot tool found (install spectacle, grim or gnome-screenshot)");
}

const DEFAULT: Size = { width: 1920, height: 1080 };

export function screenSize(): Size {
  return fromEnv() ?? fromKscreen() ?? fromWlrRandr() ?? DEFAULT;
}

function fromEnv(): Size | null {
  const match = Bun.env.MIMIC_SCREEN?.match(/^(\d+)x(\d+)$/);
  return match ? { width: +match[1], height: +match[2] } : null;
}

function fromKscreen(): Size | null {
  if (!Bun.which("kscreen-doctor")) return null;
  const out = Bun.spawnSync(["kscreen-doctor", "-o"]).stdout.toString();
  const match = out.match(/Geometry:\s*\d+,\d+\s+(\d+)x(\d+)/);
  return match ? { width: +match[1], height: +match[2] } : null;
}

function fromWlrRandr(): Size | null {
  if (!Bun.which("wlr-randr")) return null;
  const out = Bun.spawnSync(["wlr-randr"]).stdout.toString();
  const match = out.match(/(\d+)x(\d+)\s+px[^\n]*current/i);
  return match ? { width: +match[1], height: +match[2] } : null;
}
