import { EV_ABS, EV_KEY, EV_REL, EV_SYN, SYN_REPORT } from "./codes.ts";
import { close as closeFd, ioctl, ioctlPtr, open, O_NONBLOCK, O_WRONLY, write } from "./sys.ts";

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

export class VirtualDevice {
  private readonly fd: number;
  private readonly event = Buffer.alloc(24);

  constructor(spec: DeviceSpec) {
    this.fd = open(UINPUT_PATH, O_WRONLY | O_NONBLOCK);

    if (spec.keys?.length) {
      ioctl(this.fd, UI_SET_EVBIT, EV_KEY);
      for (const code of spec.keys) ioctl(this.fd, UI_SET_KEYBIT, code);
    }
    if (spec.rel?.length) {
      ioctl(this.fd, UI_SET_EVBIT, EV_REL);
      for (const code of spec.rel) ioctl(this.fd, UI_SET_RELBIT, code);
    }
    if (spec.abs?.length) {
      ioctl(this.fd, UI_SET_EVBIT, EV_ABS);
      for (const axis of spec.abs) {
        ioctl(this.fd, UI_SET_ABSBIT, axis.code);
        this.setupAbs(axis);
      }
    }

    const setup = Buffer.alloc(92);
    setup.writeUInt16LE(BUS_USB, 0);
    setup.writeUInt16LE(spec.vendor ?? 0x1d6b, 2);
    setup.writeUInt16LE(spec.product ?? 0x0001, 4);
    setup.writeUInt16LE(1, 6);
    setup.write(spec.name.slice(0, 79), 8, "utf8");
    ioctlPtr(this.fd, UI_DEV_SETUP, setup);
    ioctl(this.fd, UI_DEV_CREATE);
  }

  private setupAbs(axis: AbsAxis) {
    const buffer = Buffer.alloc(28);
    buffer.writeUInt16LE(axis.code, 0);
    buffer.writeInt32LE(axis.min, 8);
    buffer.writeInt32LE(axis.max, 12);
    ioctlPtr(this.fd, UI_ABS_SETUP, buffer);
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
    try {
      ioctl(this.fd, UI_DEV_DESTROY);
    } finally {
      closeFd(this.fd);
    }
  }
}

export function uinputWritable(): boolean {
  try {
    closeFd(open(UINPUT_PATH, O_WRONLY | O_NONBLOCK));
    return true;
  } catch {
    return false;
  }
}
