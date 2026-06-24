import { dlopen, FFIType, ptr, read } from "bun:ffi";

export const O_RDONLY = 0x0;
export const O_WRONLY = 0x1;
export const O_CREAT = 0x40;
export const O_APPEND = 0x400;
export const O_NONBLOCK = 0x800;

const EINTR = 4;
const EAGAIN = 11;
const EWOULDBLOCK = 11;
const LOCK_EX = 2;
const LOCK_NB = 4;

const WRITE_RETRY_LIMIT = 1000;

const ERRNO_NAMES: Record<number, string> = {
  1: "EPERM",
  2: "ENOENT",
  4: "EINTR",
  11: "EAGAIN",
  13: "EACCES",
  16: "EBUSY",
  19: "ENODEV",
  22: "EINVAL",
  98: "EADDRINUSE",
};

const ERRNO_STRINGS: Record<string, string> = {
  EACCES: "permission denied",
  ENOENT: "no such file",
  EADDRINUSE: "address in use",
  EAGAIN: "resource temporarily unavailable",
  EBUSY: "device busy",
  ENODEV: "no such device",
  EINVAL: "invalid argument",
  EPERM: "operation not permitted",
};

function errnoCode(errno: number): string {
  return ERRNO_NAMES[errno] ?? `E${errno}`;
}

export class SysError extends Error {
  readonly errno: number;
  readonly code: string;
  readonly syscall: string;

  constructor(syscall: string, errno: number, context?: string) {
    const code = errnoCode(errno);
    const detail = ERRNO_STRINGS[code];
    const where = context ? ` ${context}` : "";
    const tail = detail ? ` (${detail})` : "";
    super(`mimic: ${syscall}${where} failed: ${code}${tail}`);
    this.name = "SysError";
    this.errno = errno;
    this.code = code;
    this.syscall = syscall;
  }
}

const libc = (() => {
  const symbols = {
    open: { args: [FFIType.ptr, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    write: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
    read: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
    ioctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    __errno_location: { args: [], returns: FFIType.ptr },
  } as const;
  for (const name of ["libc.so.6", "/usr/lib/libc.so.6", "/lib/x86_64-linux-gnu/libc.so.6"]) {
    try {
      return dlopen(name, symbols).symbols;
    } catch {}
  }
  throw new Error("mimic: could not load libc — is this glibc?");
})();

const cstring = (path: string) => Buffer.from(`${path}\0`, "utf8");

function lastErrno(): number {
  const location = libc.__errno_location();
  if (location === null) return 0;
  return read.i32(location, 0);
}

export function open(path: string, flags: number, mode = 0o644): number {
  const fd = libc.open(cstring(path), flags, mode);
  if (fd < 0) {
    const errno = lastErrno();
    throw new SysError("open", errno, path);
  }
  return fd;
}

export function write(fd: number, bytes: Uint8Array): void {
  let written = 0;
  let retries = 0;
  while (written < bytes.byteLength) {
    const chunk = written === 0 ? bytes : bytes.subarray(written);
    const ret = libc.write(fd, chunk, BigInt(chunk.byteLength));
    if (ret < 0n) {
      const errno = lastErrno();
      if (errno === EINTR) continue;
      if (errno === EAGAIN || errno === EWOULDBLOCK) {
        if (++retries > WRITE_RETRY_LIMIT) throw new SysError("write", EAGAIN);
        continue;
      }
      throw new SysError("write", errno);
    }
    written += Number(ret);
  }
}

export function readFd(fd: number, buffer: Uint8Array): number {
  for (;;) {
    const ret = libc.read(fd, buffer, BigInt(buffer.byteLength));
    if (ret < 0n) {
      const errno = lastErrno();
      if (errno === EINTR) continue;
      if (errno === EAGAIN || errno === EWOULDBLOCK) return 0;
      throw new SysError("read", errno);
    }
    return Number(ret);
  }
}

export function close(fd: number): void {
  const ret = libc.close(fd);
  if (ret < 0) {
    const errno = lastErrno();
    throw new SysError("close", errno);
  }
}

export function ioctl(fd: number, request: number, value = 0): number {
  return libc.ioctl(fd, BigInt(request), BigInt(value));
}

export function ioctlPtr(fd: number, request: number, buffer: Uint8Array): number {
  return libc.ioctl(fd, BigInt(request), BigInt(ptr(buffer)));
}

export function ioctlChecked(fd: number, request: number, value = 0, context?: string): void {
  const ret = ioctl(fd, request, value);
  if (ret < 0) {
    const errno = lastErrno();
    throw new SysError("ioctl", errno, context);
  }
}

export function ioctlPtrChecked(fd: number, request: number, buffer: Uint8Array, context?: string): void {
  const ret = ioctlPtr(fd, request, buffer);
  if (ret < 0) {
    const errno = lastErrno();
    throw new SysError("ioctl", errno, context);
  }
}

export function flockExclusive(fd: number): boolean {
  const ret = libc.flock(fd, LOCK_EX | LOCK_NB);
  if (ret === 0) return true;
  const errno = lastErrno();
  if (errno === EWOULDBLOCK || errno === EAGAIN) return false;
  throw new SysError("flock", errno);
}
