import { readString } from "../../../memory/guest-memory";
import { Mode, Open } from "../../libc/files/constants";
import { STAT_BYTES } from "../../libc/file-metadata";
import { ErrorField } from "../errors";
import type { SystemValue } from "../../libc/system/types";
import { classPointer } from "../core-foundation/types";
import type { DirectoryEntry } from "../directory-enumerator";
import type { FileManagerHost } from "./types";

const STAT_MODE_OFFSET = 4;
const STAT_SIZE_OFFSET = 60;
const WORD = Uint32Array.BYTES_PER_ELEMENT;
const STAT_MODE_BYTES = 2;
const BYTE_BITS = 8;
const DIRENT_NAME_OFFSET = 21;
const IO_CHUNK_BYTES = 65536;
const MAX_FILE_BYTES = 0x1000_0000;
const ERROR_NUMBER_SYMBOL = "___error";
const WRITE_NEW = Open.WriteOnly | Open.Create | Open.Exclusive;
const WRITE_TRUNCATE = Open.WriteOnly | Open.Create | Open.Truncate;
export const FileOpen = {
  Read: Open.ReadOnly,
  WriteNew: WRITE_NEW,
  WriteTruncate: WRITE_TRUNCATE,
} as const;
export { IO_CHUNK_BYTES };

function numeric(value: SystemValue): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error("Unexpected non-numeric libc result");
}

/** NSFileManager and libc share one filesystem, including current directory and saves. */
export class HostFiles {
  manager: number | undefined;
  constructor(readonly host: FileManagerHost) {}

  private func(name: string) {
    const fn = this.host.sys.funcs[name];
    if (!fn) throw new Error(`Missing libc import ${name}`);
    return fn;
  }
  async invoke(name: string, ...args: number[]): Promise<number> {
    return numeric(await this.func(name)((i) => args[i] ?? 0));
  }
  errno(): number {
    const result = this.func(ERROR_NUMBER_SYMBOL)(() => 0);
    if (result instanceof Promise) throw new Error("Expected a synchronous errno location");
    return this.host.read(numeric(result));
  }
  async sendNumber(self: number, selector: string, args: number[] = []): Promise<number> {
    const result = await this.host.send(self, selector, args);
    return typeof result === "number" ? result : 0;
  }
  className(name: string): number {
    return classPointer(this.host, name);
  }
  makeError = (code: number, domain: string): number => {
    const value = this.host.alloc(this.className("NSError"));
    this.host.write(value + ErrorField.Code, code);
    this.host.write(value + ErrorField.Domain, this.host.retain(this.host.string(domain)));
    return this.host.autorelease(value);
  };
  failure(out: number): number {
    if (out) {
      const value = this.host.alloc(this.className("NSError"));
      this.host.write(value + ErrorField.Code, this.errno());
      this.host.write(out, this.host.autorelease(value));
    }
    return 0;
  }
  async stat(path: number, directory: number): Promise<number> {
    const { heap, cpu } = this.host;
    const scratch = heap.zero(STAT_BYTES);
    try {
      const ok = (await this.invoke("_stat", path, scratch)) === 0;
      const bytes = ok ? cpu.read(scratch + STAT_MODE_OFFSET, STAT_MODE_BYTES) : null;
      const type = bytes ? (bytes[0] ?? 0) | ((bytes[1] ?? 0) << BYTE_BITS) : 0;
      if (directory)
        cpu.write(directory, Uint8Array.of(Number((type & Mode.TypeMask) === Mode.Directory)));
      return ok ? type : 0;
    } finally {
      heap.free(scratch);
    }
  }
  isDirectory(mode: number): boolean {
    return (mode & Mode.TypeMask) === Mode.Directory;
  }
  async pathCall<T>(path: string, call: (pointer: number) => Promise<T> | T): Promise<T> {
    const pointer = this.host.heap.string(path);
    try {
      return await call(pointer);
    } finally {
      this.host.heap.free(pointer);
    }
  }
  /** Entry names other than "." and "..", or null when the directory cannot be opened. */
  async listNames(pointer: number): Promise<string[] | null> {
    const directory = await this.invoke("_opendir", pointer);
    if (!directory) return null;
    const names: string[] = [];
    try {
      for (let entry = await this.invoke("_readdir", directory); entry;) {
        const name = readString(this.host.cpu, entry + DIRENT_NAME_OFFSET);
        if (name !== "." && name !== "..") names.push(name);
        entry = await this.invoke("_readdir", directory);
      }
    } finally {
      await this.invoke("_closedir", directory);
    }
    return names;
  }
  async listDirectory(path: string): Promise<DirectoryEntry[] | undefined> {
    const names = await this.pathCall(path, (pointer) => this.listNames(pointer));
    if (!names) return undefined;
    const entries: DirectoryEntry[] = [];
    for (const name of names)
      entries.push({
        name,
        directory: await this.pathCall(`${path.replace(/\/+$/, "")}/${name}`, async (child) =>
          this.isDirectory(await this.stat(child, 0)),
        ),
      });
    return entries;
  }
  async contents(path: number): Promise<Uint8Array | undefined> {
    if (!path) return undefined;
    const { heap, cpu, read } = this.host;
    const descriptor = await this.invoke("_open", this.host.utf8(path), FileOpen.Read);
    if (descriptor < 0) return undefined;
    const scratch = heap.zero(STAT_BYTES);
    let buffer = 0;
    try {
      if ((await this.invoke("_fstat", descriptor, scratch)) !== 0) return undefined;
      const size = read(scratch + STAT_SIZE_OFFSET);
      if (read(scratch + STAT_SIZE_OFFSET + WORD) || size > MAX_FILE_BYTES) return undefined;
      const output = new Uint8Array(size);
      buffer = heap.alloc(Math.min(IO_CHUNK_BYTES, Math.max(1, size)));
      if (!buffer) return undefined;
      for (let offset = 0; offset < size;) {
        const count = await this.invoke(
          "_read",
          descriptor,
          buffer,
          Math.min(IO_CHUNK_BYTES, size - offset),
        );
        if (count <= 0) return undefined;
        output.set(cpu.read(buffer, count), offset);
        offset += count;
      }
      return output;
    } finally {
      if (buffer) heap.free(buffer);
      heap.free(scratch);
      await this.invoke("_close", descriptor);
    }
  }
}
