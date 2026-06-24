# mimic

**Drive your computer like a human.** `mimic` moves the mouse, clicks, scrolls and types
through the Linux kernel's own input subsystem — so the events are physically
indistinguishable from a real keyboard and mouse. No browser, no accessibility API,
no synthetic-event fingerprint for anti-bots to catch.

<p>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-black">
  <img alt="runtime" src="https://img.shields.io/badge/runtime-Bun-black">
  <img alt="platform" src="https://img.shields.io/badge/Wayland-tested%20on%20KDE%2FKWin-black">
</p>

```sh
bun i -g mimic        # install the CLI
mimic setup           # grant uinput access (once, asks for sudo)
mimic doctor          # confirm the machine is ready

mimic move 960 540
mimic click 200 120
mimic type "hello from a real keyboard"
mimic paste "açaí, naïve, 日本語 — even unicode"
```

## Why it's undetectable

Most automation tools inject events at the application or browser layer, where they
carry tell-tale flags (`isTrusted: false`, missing timing, no device). `mimic` instead
creates **virtual input devices** with [`uinput`](https://www.kernel.org/doc/html/latest/input/uinput.html)
and feeds events into the kernel's input core. From there on, your mouse and a `mimic`
mouse travel the exact same path:

```mermaid
flowchart LR
  cli["mimic (CLI / library)"] -->|"JSON over unix socket"| daemon["mimic daemon"]
  daemon -->|"ioctl + write via bun:ffi"| dev["/dev/uinput"]
  dev --> core["Linux input core"]
  core --> comp["Wayland compositor"]
  comp --> apps["your apps"]
  hw["real mouse / keyboard"] --> core
```

The pointer is an **absolute** device (it reports pixel coordinates, not deltas), so
there is no pointer acceleration to fight and every `move` lands exactly where asked.
Motion follows a curved, eased, slightly jittered path with human-like timing.

## Install

```sh
bun i -g mimic
mimic setup
```

`mimic setup` is idempotent. If `/dev/uinput` is already writable it does nothing;
otherwise it loads the `uinput` module (now and on boot), installs a udev rule giving
the `input` group access to the device, and adds you to that group. Log out and back
in once for the group change to take effect, then:

```sh
mimic doctor
```

### Security: the `input` group

`mimic setup` adds your user to the `input` group. Membership in that group grants
**read access to every `/dev/input/event*` device** — that is, the ability to read
keystrokes and pointer events from all real keyboards and mice on the system. In
practice this is local keylogging capability. `mimic` itself only ever *writes* to a
virtual device, but the group permission it relies on is broad. Understand this
trade-off before running `mimic setup`, and don't grant it to untrusted accounts.

## Usage

```sh
mimic shot screen.png                # screenshot the desktop
mimic move 960 540                   # glide the pointer
mimic click                          # click where the pointer is
mimic click 480 300 -b right         # right-click at a point
mimic dblclick 480 300               # double click
mimic drag 100 100 600 400           # press, move, release
mimic scroll -5                      # scroll down five notches
mimic type "git commit -m wip"       # type on the keyboard
mimic paste "anything — even 🎉"     # paste through the clipboard
mimic key ctrl+c                     # key combos
mimic where                          # -> "960 540"
mimic geometry                       # -> "1920x1080"

mimic <any command> --dry-run        # log the action without performing it
mimic daemon status|stop|log         # manage the background daemon
```

The first command starts a small background **daemon** and waits while the virtual
devices warm up (~2.5s, paid once). Every command after that is instant — the daemon
holds the devices open and tracks the cursor so motion can stay relative to where it is.

## As a library

```ts
import { call, Hands } from "mimic";

await call("move", { x: 960, y: 540 });
await call("type", { text: "hello" });
const [x, y] = (await call("where")) as number[];
```

`call()` autostarts the daemon on first use and speaks the same protocol the CLI does.
For an in-process controller without the daemon, use the `Hands` class directly. Both
are re-exported from the package entrypoint.

## Architecture

A handful of deep modules, each hiding one concern behind a small surface:

| module        | responsibility                                                        |
| ------------- | --------------------------------------------------------------------- |
| `sys.ts`      | the only `bun:ffi` boundary — `open` / `write` / `close` / `ioctl`    |
| `codes.ts`    | input-event constants and the character → keystroke map               |
| `uinput.ts`   | `UinputDevice` — create, configure and feed a uinput device           |
| `hands.ts`    | human-like mouse and keyboard on top of the devices                   |
| `desktop.ts`  | screenshots and screen geometry from the Wayland environment          |
| `service.ts`  | the wire protocol, the daemon (`serve`) and the client (`call`)       |
| `system.ts`   | `mimic doctor` and `mimic setup`                                      |
| `cli.ts`      | argument parsing and dispatch                                         |

No native addons and no Python — just Bun calling libc directly.

## Geometry detection

`mimic` needs the screen size to map absolute pointer coordinates. It resolves it in
order:

1. `MIMIC_SCREEN` (e.g. `1920x1080`), if set.
2. `kscreen-doctor -o` (KDE/KWin).
3. `wlr-randr` (wlroots compositors).
4. A `1920x1080` default — printed as a warning on stderr if nothing else resolved.

If detection falls back to the default and your display is a different size, set
`MIMIC_SCREEN` explicitly so coordinates land where you expect.

## Configuration

| variable       | meaning                                  | default              |
| -------------- | ---------------------------------------- | -------------------- |
| `MIMIC_SCREEN` | override detected geometry, e.g. `1920x1080` | autodetected     |
| `MIMIC_WARMUP` | device warm-up before the first action, ms   | `2500`           |

## Requirements

- Linux with `uinput` (any modern kernel).
- A **Wayland** session. `mimic` is developed and tested on **KDE/KWin**. Other Wayland
  compositors may work — the input path (uinput → kernel → compositor) is compositor
  agnostic — but geometry detection only ships KDE (`kscreen-doctor`) and wlroots
  (`wlr-randr`) backends; elsewhere set `MIMIC_SCREEN` (see Geometry detection above).
  X11 is not supported.
- [Bun](https://bun.sh) ≥ 1.1.
- A screenshot tool (`spectacle`, `grim` or `gnome-screenshot`) for `mimic shot`,
  and `wl-clipboard` for `mimic paste`. `mimic doctor` tells you what's missing.

## Not yet

Honest about what isn't here:

- No compositor oracle — positions are not yet verified against the compositor (e.g. a
  KWin script reporting `workspace.cursorPos`).
- No X11 support.
- No geometry backends for GNOME/Mutter or other compositors beyond KDE and wlroots.
- CI runs the pure tests only; there is no privileged CI exercising real `/dev/uinput`.

## License

MIT © juicerq
