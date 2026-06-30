export interface Size {
  width: number;
  height: number;
}

export interface Region extends Size {
  x: number;
  y: number;
}

export interface View {
  region?: Region;
  zoom?: number;
  grid?: number;
}

export interface Match {
  x: number;
  y: number;
  score: number;
}

const tmpDir = Bun.env.XDG_RUNTIME_DIR ?? "/tmp";

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

export async function screenshot(path: string, view?: View): Promise<string> {
  const available = availableBackends();

  if (available.length === 0) {
    throw new Error("mimic: no screenshot tool found (install spectacle, grim or gnome-screenshot)");
  }

  let captured = false;
  for (const backend of available) {
    const proc = Bun.spawn([backend.tool, ...backend.args(path)], { stdout: "ignore", stderr: "ignore" });
    if ((await proc.exited) === 0) {
      captured = true;
      break;
    }
  }
  if (!captured) throw new Error("mimic: screenshot failed (all available tools returned non-zero)");

  if (view && (view.region || view.zoom || view.grid)) await transform(path, view);
  return path;
}

async function magick(args: string[]): Promise<void> {
  if (!Bun.which("magick")) throw new Error("mimic: --region/--zoom/--grid need ImageMagick (install imagemagick)");
  const proc = Bun.spawn(["magick", ...args], { stdout: "ignore", stderr: "pipe" });
  const err = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) throw new Error(`mimic: image processing failed: ${err.trim()}`);
}

async function transform(path: string, view: View): Promise<void> {
  const region = view.region ?? { x: 0, y: 0, ...screenSize() };
  const zoom = view.zoom && view.zoom > 0 ? view.zoom : 1;

  const args = [path];
  if (view.region) args.push("-crop", `${region.width}x${region.height}+${region.x}+${region.y}`, "+repage");
  if (zoom !== 1) args.push("-resize", `${zoom * 100}%`);
  if (view.grid)
    args.push("-stroke", "red", "-strokeWidth", "1", "-fill", "red", "-draw", gridDraw(region, zoom, view.grid));
  args.push(path);
  await magick(args);
}

export function gridDraw(region: Region, zoom: number, step: number): string {
  const outWidth = region.width * zoom;
  const outHeight = region.height * zoom;
  const cmds: string[] = [];
  for (let x = Math.ceil(region.x / step) * step; x <= region.x + region.width; x += step) {
    const px = Math.round((x - region.x) * zoom);
    cmds.push(`line ${px},0 ${px},${outHeight}`, `text ${px + 2},14 '${x}'`);
  }
  for (let y = Math.ceil(region.y / step) * step; y <= region.y + region.height; y += step) {
    const py = Math.round((y - region.y) * zoom);
    cmds.push(`line 0,${py} ${outWidth},${py}`, `text 2,${py + 14} '${y}'`);
  }
  return cmds.join(" ");
}

export interface Gray {
  px: Float64Array;
  width: number;
  height: number;
}

function moments(px: Float64Array): { mean: number; norm: number } {
  let mean = 0;
  for (const v of px) mean += v;
  mean /= px.length;
  let ss = 0;
  for (const v of px) ss += (v - mean) ** 2;
  return { mean, norm: Math.sqrt(ss) };
}

function downscale({ px, width, height }: Gray, factor: number): Gray {
  const w = Math.floor(width / factor);
  const h = Math.floor(height / factor);
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let j = 0; j < factor; j++)
        for (let i = 0; i < factor; i++) sum += px[(y * factor + j) * width + (x * factor + i)];
      out[y * w + x] = sum / (factor * factor);
    }
  }
  return { px: out, width: w, height: h };
}

function nccAt(hay: Gray, x: number, y: number, tpl: Gray, tmean: number, tnorm: number): number {
  const n = tpl.px.length;
  let dot = 0;
  let sum = 0;
  let sumSq = 0;
  for (let j = 0; j < tpl.height; j++) {
    const hayRow = (y + j) * hay.width + x;
    const tplRow = j * tpl.width;
    for (let i = 0; i < tpl.width; i++) {
      const v = hay.px[hayRow + i];
      dot += v * tpl.px[tplRow + i];
      sum += v;
      sumSq += v * v;
    }
  }
  const variance = sumSq - (sum * sum) / n;
  if (variance <= 1e-6) return -2;
  return (dot - sum * tmean) / (Math.sqrt(variance) * tnorm);
}

const COARSE = 4;
const CANDIDATES = 8;

// Normalized cross-correlation. compare -subimage-search degenerates on real desktops (its NCC
// divides by local variance, so flat panels/backgrounds score spuriously high), so we do the NCC
// ourselves with a variance guard. ponytail: coarse-to-fine over a /COARSE downscale keeps it ~O(screen);
// false coarse peaks are caught by refining the top CANDIDATES at full resolution. Upgrade path:
// integral-image or FFT acceleration if a single coarse pass ever proves too slow.
export function match(hay: Gray, tpl: Gray): Match | null {
  const full = moments(tpl.px);
  if (full.norm / Math.sqrt(tpl.px.length) < 0.01) return null; // featureless template — nothing to lock onto

  // tiny templates can't survive the downscale; search them at full resolution (cheap anyway)
  const factor = tpl.width >= 2 * COARSE && tpl.height >= 2 * COARSE ? COARSE : 1;
  const hayLow = downscale(hay, factor);
  const tplLow = downscale(tpl, factor);
  const low = moments(tplLow.px);

  const coarse: Match[] = [];
  for (let y = 0; y <= hayLow.height - tplLow.height; y++) {
    for (let x = 0; x <= hayLow.width - tplLow.width; x++) {
      coarse.push({ x, y, score: nccAt(hayLow, x, y, tplLow, low.mean, low.norm) });
    }
  }
  coarse.sort((a, b) => b.score - a.score);

  const top: Match[] = [];
  for (const c of coarse) {
    if (top.length >= CANDIDATES) break;
    if (top.some((t) => Math.abs(t.x - c.x) < tplLow.width && Math.abs(t.y - c.y) < tplLow.height)) continue;
    top.push(c);
  }

  const pad = factor + 2;
  let best: Match = { x: 0, y: 0, score: -2 };
  for (const c of top) {
    const cx = c.x * factor;
    const cy = c.y * factor;
    for (let y = Math.max(0, cy - pad); y <= Math.min(hay.height - tpl.height, cy + pad); y++) {
      for (let x = Math.max(0, cx - pad); x <= Math.min(hay.width - tpl.width, cx + pad); x++) {
        const score = nccAt(hay, x, y, tpl, full.mean, full.norm);
        if (score > best.score) best = { x, y, score };
      }
    }
  }
  return { x: best.x + (tpl.width >> 1), y: best.y + (tpl.height >> 1), score: best.score };
}

async function readGray(path: string): Promise<Gray> {
  const sized = Bun.spawnSync(["identify", "-format", "%w %h", path]);
  const [width, height] = sized.stdout.toString().trim().split(" ").map(Number);
  if (!width || !height) throw new Error(`mimic: cannot read image '${path}'`);
  const raw = Bun.spawnSync(["magick", path, "-colorspace", "Gray", "-depth", "8", "gray:-"]).stdout;
  if (raw.length < width * height) throw new Error(`mimic: cannot read image '${path}'`);
  const px = new Float64Array(width * height);
  for (let i = 0; i < px.length; i++) px[i] = raw[i] / 255;
  return { px, width, height };
}

export async function find(template: string, threshold = 0.8): Promise<Match | null> {
  if (!Bun.which("magick") || !Bun.which("identify"))
    throw new Error("mimic: find needs ImageMagick (install imagemagick)");
  if (!(await Bun.file(template).exists())) throw new Error(`mimic: template not found: ${template}`);

  const haystack = `${tmpDir}/mimic-haystack.png`;
  await screenshot(haystack);
  const hay = await readGray(haystack);
  const tpl = await readGray(template);
  if (tpl.width > hay.width || tpl.height > hay.height) throw new Error("mimic: template is larger than the screen");

  const hit = match(hay, tpl);
  return hit && hit.score >= threshold ? hit : null;
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

function stripAnsi(out: string): string {
  return out.replace(/\x1b\[[0-9;]*m/g, "");
}

export function parseKscreen(out: string): Size | null {
  const match = stripAnsi(out).match(/Geometry:\s*\d+,\d+\s+(\d+)x(\d+)/);
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
