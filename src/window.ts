const tmpDir = Bun.env.XDG_RUNTIME_DIR ?? "/tmp";

export interface Win {
  class: string;
  caption: string;
  x: number;
  y: number;
  width: number;
  height: number;
  active: boolean;
}

type Action = "list" | "find" | "activate";

const script = (token: string, action: Action, query: string) => `
var ws = workspace;
var list = ws.windowList ? ws.windowList() : ws.clientList();
var q = ${JSON.stringify(query.toLowerCase())};
var active = ("activeWindow" in ws) ? ws.activeWindow : ws.activeClient;
for (var i = 0; i < list.length; i++) {
  var w = list[i];
  var cls = String(w.resourceClass || "");
  var cap = String(w.caption || "");
  if (q !== "" && cls.toLowerCase().indexOf(q) < 0 && cap.toLowerCase().indexOf(q) < 0) continue;
  if (${JSON.stringify(action)} === "activate") {
    if ("activeWindow" in ws) ws.activeWindow = w; else ws.activeClient = w;
  }
  var g = w.frameGeometry;
  print(${JSON.stringify(token)} + " " + cls + "\\t" + cap + "\\t" + g.x + "\\t" + g.y + "\\t" + g.width + "\\t" + g.height + "\\t" + (w === active));
  if (${JSON.stringify(action)} !== "list") break;
}
`;

export function parseWindowLine(line: string, token: string): Win | null {
  const at = line.indexOf(token);
  if (at < 0) return null;
  const [cls, caption, x, y, width, height, active] = line
    .slice(at + token.length)
    .trim()
    .split("\t");
  if (height === undefined) return null;
  return { class: cls, caption, x: +x, y: +y, width: +width, height: +height, active: active === "true" };
}

async function dbus(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["dbus-send", "--print-reply", "--dest=org.kde.KWin", ...args], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error("mimic: KWin D-Bus call failed (is this a KWin session?)");
  return out;
}

// ponytail: KWin scripts can only return data through journald, so we read it back by a unique
// per-call token. Ceiling: needs a systemd user journal carrying kwin's output. Upgrade path:
// have the script callDBus back into a mimic listener.
async function readJournal(token: string): Promise<Win[]> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const proc = Bun.spawn(["journalctl", "--user", "-b", "--since", "10 seconds ago", "-o", "cat", "--no-pager"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const wins = out
      .split("\n")
      .filter((line) => line.includes(token))
      .map((line) => parseWindowLine(line, token))
      .filter((win): win is Win => win !== null);
    if (wins.length > 0) return wins;
    await Bun.sleep(100);
  }
  return [];
}

async function run(action: Action, query: string): Promise<Win[]> {
  const token = `MIMIC${Math.random().toString(36).slice(2)}`;
  const file = `${tmpDir}/mimic-kwin-${token}.js`;
  await Bun.write(file, script(token, action, query));
  try {
    const loaded = await dbus("/Scripting", "org.kde.kwin.Scripting.loadScript", `string:${file}`, `string:${token}`);
    const id = loaded.match(/int32\s+(\d+)/)?.[1];
    if (id === undefined) throw new Error("mimic: KWin did not return a script id");
    await dbus(`/Scripting/Script${id}`, "org.kde.kwin.Script.run");
    await dbus("/Scripting", "org.kde.kwin.Scripting.unloadScript", `string:${token}`);
    return readJournal(token);
  } finally {
    await Bun.file(file)
      .delete()
      .catch(() => {});
  }
}

export function listWindows(): Promise<Win[]> {
  return run("list", "");
}

async function first(action: Action, query: string): Promise<Win> {
  const [win] = await run(action, query);
  if (!win) throw new Error(`mimic: no window matching '${query}'`);
  return win;
}

export const findWindow = (query: string) => first("find", query);
export const activateWindow = (query: string) => first("activate", query);
