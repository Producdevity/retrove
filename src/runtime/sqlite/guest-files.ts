import type { GuestArguments } from "../ios/objc/host";
import type { GuestMemory, Heap } from "../memory/guest-memory";

const CHUNK = 65_536;
const O_RDONLY = 0;
const O_WRONLY = 1;
const O_CREAT = 0x200;
const O_TRUNC = 0x400;
const FILE_MODE = 0o644;

export interface GuestLibc {
  readonly funcs: Readonly<Record<string, (a: GuestArguments) => number | Promise<number>>>;
}
export interface GuestFiles {
  readonly readFile: (path: string) => Promise<Uint8Array | undefined>;
  readonly writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
}

/** Whole-file reads and writes through the guest's libc, so paths resolve like the app's own. */
export function guestFiles(
  cpu: GuestMemory,
  heap: Pick<Heap, "alloc" | "free" | "string">,
  sys: GuestLibc,
): GuestFiles {
  const call = async (name: string, ...args: number[]): Promise<number> => {
    const func = sys.funcs[name];
    if (!func) throw new Error(`Missing guest libc function ${name}`);
    return func((index) => args[index] ?? 0);
  };
  async function withPath<T>(path: string, use: (pointer: number) => Promise<T>): Promise<T> {
    const pointer = heap.string(path);
    try {
      return await use(pointer);
    } finally {
      heap.free(pointer);
    }
  }
  async function readFile(path: string): Promise<Uint8Array | undefined> {
    return withPath(path, async (pointer) => {
      const fd = (await call("_open", pointer, O_RDONLY)) | 0;
      if (fd < 0) return undefined;
      const buffer = heap.alloc(CHUNK),
        parts: Uint8Array[] = [];
      try {
        for (;;) {
          const count = (await call("_read", fd, buffer, CHUNK)) | 0;
          if (count < 0) throw new Error(`Could not read SQLite database ${path}`);
          if (!count) break;
          parts.push(cpu.read(buffer, count));
        }
      } finally {
        heap.free(buffer);
        await call("_close", fd);
      }
      const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      return bytes;
    });
  }
  async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
    await withPath(path, async (pointer) => {
      const fd = (await call("_open", pointer, O_WRONLY | O_CREAT | O_TRUNC, FILE_MODE)) | 0;
      if (fd < 0) throw new Error(`Could not write SQLite database ${path}`);
      const buffer = heap.alloc(CHUNK);
      try {
        for (let offset = 0; offset < bytes.length;) {
          const size = Math.min(CHUNK, bytes.length - offset);
          cpu.write(buffer, bytes.subarray(offset, offset + size));
          const written = (await call("_write", fd, buffer, size)) | 0;
          if (written <= 0) throw new Error(`Could not write SQLite database ${path}`);
          offset += written;
        }
      } finally {
        heap.free(buffer);
        await call("_close", fd);
      }
    });
  }
  return { readFile, writeFile };
}
