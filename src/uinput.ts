import { EV_ABS, EV_KEY, EV_REL, EV_SYN, SYN_REPORT } from "./codes.ts";
import { close as closeFd, ioctlChecked, ioctlPtrChecked, O_NONBLOCK, O_WRONLY, open, SysError, write } from "./sys.ts";

const UI_SET_EVBIT = 0x40045564;
const UI_SET_KEYBIT = 0x40045565;
const UI_SET_RELBIT = 0x40045566;
const UI_SET_ABSBIT = 0x40045567;
const UI_DEV_SETUP = 0x405c5503;
const UI_ABS_SETUP = 0x401c5504;
const UI_DEV_CREATE = 0x5501;
const UI_DEV_DESTROY = 0x5502;

const BUS_USB = 0x03;
const UINPUT_PATH = "/dev/uinput";

export interface AbsAxis {
  code: number;
  min: number;
  max: number;
}

export interface DeviceSpec {
  name: string;
  vendor?: number;
  product?: number;
  keys?: number[];
  rel?: number[];
  abs?: AbsAxis[];
}

export interface VirtualDevice {
  emit(type: number, code: number, value: number): void;
  syn(): void;
  close(): void;
}

export type DeviceFactory = (spec: DeviceSpec) => VirtualDevice;

function openUinput(): number {
  try {
    return open(UINPUT_PATH, O_WRONLY | O_NONBLOCK);
  } catch (e) {
    if (e instanceof SysError) {
      if (e.code === "EACCES") {
        throw new Error("mimic: cannot open /dev/uinput: permission denied — run 'mimic setup'");
      }
      if (e.code === "ENOENT") {
        throw new Error("mimic: cannot open /dev/uinput: uinput module not loaded — run 'mimic setup'");
      }
    }
    throw e;
  }
}

export class UinputDevice implements VirtualDevice {
  private readonly fd: number;
  private readonly event = Buffer.alloc(24);

  constructor(spec: DeviceSpec) {
    this.fd = openUinput();
    try {
      if (spec.keys?.length) {
        ioctlChecked(this.fd, UI_SET_EVBIT, EV_KEY, "UI_SET_EVBIT(EV_KEY)");
        for (const code of spec.keys) ioctlChecked(this.fd, UI_SET_KEYBIT, code, "UI_SET_KEYBIT");
      }
      if (spec.rel?.length) {
        ioctlChecked(this.fd, UI_SET_EVBIT, EV_REL, "UI_SET_EVBIT(EV_REL)");
        for (const code of spec.rel) ioctlChecked(this.fd, UI_SET_RELBIT, code, "UI_SET_RELBIT");
      }
      if (spec.abs?.length) {
        ioctlChecked(this.fd, UI_SET_EVBIT, EV_ABS, "UI_SET_EVBIT(EV_ABS)");
        for (const axis of spec.abs) {
          ioctlChecked(this.fd, UI_SET_ABSBIT, axis.code, "UI_SET_ABSBIT");
          this.setupAbs(axis);
        }
      }

      const setup = Buffer.alloc(92);
      setup.writeUInt16LE(BUS_USB, 0);
      setup.writeUInt16LE(spec.vendor ?? 0x1d6b, 2);
      setup.writeUInt16LE(spec.product ?? 0x0001, 4);
      setup.writeUInt16LE(1, 6);
      setup.write(spec.name.slice(0, 79), 8, "utf8");
      ioctlPtrChecked(this.fd, UI_DEV_SETUP, setup, "UI_DEV_SETUP");
      ioctlChecked(this.fd, UI_DEV_CREATE, 0, "UI_DEV_CREATE");
    } catch (e) {
      closeFd(this.fd);
      throw e;
    }
  }

  private setupAbs(axis: AbsAxis) {
    const buffer = Buffer.alloc(28);
    buffer.writeUInt16LE(axis.code, 0);
    buffer.writeInt32LE(axis.min, 8);
    buffer.writeInt32LE(axis.max, 12);
    ioctlPtrChecked(this.fd, UI_ABS_SETUP, buffer, "UI_ABS_SETUP");
  }

  emit(type: number, code: number, value: number) {
    this.event.writeUInt16LE(type, 16);
    this.event.writeUInt16LE(code, 18);
    this.event.writeInt32LE(value | 0, 20);
    write(this.fd, this.event);
  }

  syn() {
    this.emit(EV_SYN, SYN_REPORT, 0);
  }

  close() {
    let first: unknown;
    try {
      ioctlChecked(this.fd, UI_DEV_DESTROY, 0, "UI_DEV_DESTROY");
    } catch (e) {
      first = e;
    }
    try {
      closeFd(this.fd);
    } catch (e) {
      if (first === undefined) first = e;
    }
    if (first !== undefined) throw first;
  }
}

export const createUinputDevice: DeviceFactory = (spec) => new UinputDevice(spec);

export function uinputWritable(): boolean {
  try {
    closeFd(open(UINPUT_PATH, O_WRONLY | O_NONBLOCK));
    return true;
  } catch {
    return false;
  }
}
