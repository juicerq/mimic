export interface Size {
  width: number;
  height: number;
}

interface Backend {
  tool: string;
  args: (path: string) => string[];
}

const BACKENDS: Backend[] = [
  { tool: "spectacle", args: (path) => ["-b", "-n", "-f", "-o", path] },
  { tool: "grim", args: (path) => [path] },
  { tool: "gnome-screenshot", args: (path) => ["-f", path] },
];

function availableBackends(): Backend[] {
  return BACKENDS.filter((backend) => Bun.which(backend.tool));
}

export function screenshotTool(): string | null {
  return availableBackends()[0]?.tool ?? null;
}

export async function screenshot(path: string): Promise<string> {
  const available = availableBackends();

  if (available.length === 0) {
    throw new Error("mimic: no screenshot tool found (install spectacle, grim or gnome-screenshot)");
  }

  for (const backend of available) {
    const proc = Bun.spawn([backend.tool, ...backend.args(path)], { stdout: "ignore", stderr: "ignore" });
    if ((await proc.exited) === 0) return path;
  }

  throw new Error("mimic: screenshot failed (all available tools returned non-zero)");
}

const DEFAULT: Size = { width: 1920, height: 1080 };

function size(width: number, height: number): Size | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

export function parseEnv(s: string): Size | null {
  const match = s.match(/^(\d+)x(\d+)$/);
  return match ? size(+match[1], +match[2]) : null;
}

export function parseKscreen(out: string): Size | null {
  const match = out.match(/Geometry:\s*\d+,\d+\s+(\d+)x(\d+)/);
  return match ? size(+match[1], +match[2]) : null;
}

export function parseWlrRandr(out: string): Size | null {
  const match = out.match(/(\d+)x(\d+)\s+px[^\n]*current/i);
  return match ? size(+match[1], +match[2]) : null;
}

function fromEnv(): Size | null {
  return Bun.env.MIMIC_SCREEN ? parseEnv(Bun.env.MIMIC_SCREEN) : null;
}

function fromKscreen(): Size | null {
  if (!Bun.which("kscreen-doctor")) return null;
  return parseKscreen(Bun.spawnSync(["kscreen-doctor", "-o"]).stdout.toString());
}

function fromWlrRandr(): Size | null {
  if (!Bun.which("wlr-randr")) return null;
  return parseWlrRandr(Bun.spawnSync(["wlr-randr"]).stdout.toString());
}

export function screenSize(): Size {
  const detected = fromEnv() ?? fromKscreen() ?? fromWlrRandr();

  if (!detected) {
    console.error("mimic: could not detect screen geometry, falling back to 1920x1080 — set MIMIC_SCREEN=WxH");
    return DEFAULT;
  }

  return detected;
}
