import { dlopen, FFIType, ptr } from "bun:ffi";

export const O_WRONLY = 0x1;
export const O_CREAT = 0x40;
export const O_APPEND = 0x400;
export const O_NONBLOCK = 0x800;

const libc = (() => {
  const symbols = {
    open: { args: [FFIType.ptr, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    write: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
    ioctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  } as const;
  for (const name of ["libc.so.6", "/usr/lib/libc.so.6", "/lib/x86_64-linux-gnu/libc.so.6"]) {
    try {
      return dlopen(name, symbols).symbols;
    } catch {}
  }
  throw new Error("mimic: could not load libc — is this glibc?");
})();

const cstring = (path: string) => Buffer.from(`${path}\0`, "utf8");

export function open(path: string, flags: number, mode = 0o644): number {
  const fd = libc.open(cstring(path), flags, mode);
  if (fd < 0) throw new Error(`mimic: cannot open ${path} (need permission — try 'mimic setup')`);
  return fd;
}

export function write(fd: number, bytes: Uint8Array): void {
  libc.write(fd, bytes, BigInt(bytes.byteLength));
}

export function close(fd: number): void {
  libc.close(fd);
}

export function ioctl(fd: number, request: number, value = 0): number {
  return libc.ioctl(fd, BigInt(request), BigInt(value));
}

export function ioctlPtr(fd: number, request: number, buffer: Uint8Array): number {
  return libc.ioctl(fd, BigInt(request), BigInt(ptr(buffer)));
}
