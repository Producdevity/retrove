import type { SqliteModule } from "../../../web/vendor/sqlite3.mjs";

export const SqliteCode = {
  Ok: 0,
  Error: 1,
  Abort: 4,
  Busy: 5,
  Misuse: 21,
  Range: 25,
  Row: 100,
  Done: 101,
} as const;
export const OpenFlag = { ReadOnly: 1, ReadWrite: 2, Create: 4 } as const;
/** sqlite3_deserialize flags: the database owns and may grow the buffer. */
const Deserialize = { FreeOnClose: 1, Resizeable: 2, ReadOnly: 4 } as const;
const DESERIALIZE_OWNED = Deserialize.FreeOnClose | Deserialize.Resizeable;
/** SQLITE_TRANSIENT: SQLite copies bound values before the call returns. */
export const TRANSIENT = -1;
const WORD = 4;
const POINTER_MASK = 0xffffffff;
const INT64_BYTES = 8;

type Value = number | bigint;
/** The raw SQLite C API in the WebAssembly module, with explicit pointer handling. */
export class SqliteEngine {
  constructor(private readonly module: SqliteModule) {}
  private function(name: string): (...args: Value[]) => unknown {
    const exported = this.module.wasm.exports[name];
    if (typeof exported !== "function") throw new Error(`SQLite lacks ${name}.`);
    return (...args): unknown => Reflect.apply(exported, undefined, args);
  }
  run(name: string, ...args: Value[]): void {
    this.function(name)(...args);
  }
  number(name: string, ...args: Value[]): number {
    const result = this.function(name)(...args);
    if (typeof result !== "number") throw new Error(`SQLite ${name} did not return a number.`);
    return result;
  }
  bigint(name: string, ...args: Value[]): bigint {
    const result = this.function(name)(...args);
    if (typeof result !== "bigint")
      throw new Error(`SQLite ${name} did not return a 64-bit value.`);
    return result;
  }
  allocate(bytes: number): number {
    const pointer = this.module.wasm.alloc(Math.max(1, bytes));
    if (!pointer) throw new Error("SQLite memory is exhausted.");
    return pointer;
  }
  free(pointer: number): void {
    if (pointer) this.module.wasm.dealloc(pointer);
  }
  write(pointer: number, bytes: Uint8Array): void {
    this.module.wasm.heap8u().set(bytes, pointer);
  }
  read(pointer: number, length: number): Uint8Array {
    return this.module.wasm.heap8u().slice(pointer, pointer + length);
  }
  word(pointer: number): number {
    const heap = this.module.wasm.heap8u();
    return new DataView(heap.buffer, heap.byteOffset).getUint32(pointer, true);
  }
  /** Bytes of a NUL-terminated string, without the terminator. */
  cString(pointer: number): Uint8Array {
    const heap = this.module.wasm.heap8u();
    const end = heap.indexOf(0, pointer);
    return heap.slice(pointer, end < 0 ? pointer : end);
  }
  /** A NUL-terminated copy the caller frees. */
  copyString(bytes: Uint8Array): number {
    const pointer = this.allocate(bytes.length + 1);
    this.write(pointer, bytes);
    this.write(pointer + bytes.length, new Uint8Array(1));
    return pointer;
  }
  withPointer<T>(use: (slot: number) => T): T {
    const slot = this.allocate(WORD);
    try {
      this.write(slot, new Uint8Array(WORD));
      return use(slot);
    } finally {
      this.free(slot);
    }
  }
  /** Opens `name`, returning the result code and the handle SQLite sets even on failure. */
  open(name: Uint8Array, flags: number): { code: number; db: number } {
    const path = this.copyString(name);
    try {
      return this.withPointer((slot) => {
        const code = this.number("sqlite3_open_v2", path, slot, flags, 0);
        return { code, db: this.word(slot) };
      });
    } finally {
      this.free(path);
    }
  }
  /** Replaces the main database with a copy of `bytes`. */
  load(db: number, bytes: Uint8Array, readOnly: boolean): number {
    if (!bytes.length) return SqliteCode.Ok;
    const buffer = this.allocate(bytes.length);
    this.write(buffer, bytes);
    const main = this.copyString(new TextEncoder().encode("main"));
    try {
      const size = BigInt(bytes.length);
      return this.number(
        "sqlite3_deserialize",
        db,
        main,
        buffer,
        size,
        size,
        DESERIALIZE_OWNED | (readOnly ? Deserialize.ReadOnly : 0),
      );
    } finally {
      this.free(main);
    }
  }
  /** The main database's file image. */
  save(db: number): Uint8Array {
    const main = this.copyString(new TextEncoder().encode("main"));
    const size = this.allocate(INT64_BYTES);
    try {
      const image = this.number("sqlite3_serialize", db, main, size, 0) & POINTER_MASK;
      if (!image) return new Uint8Array();
      const heap = this.module.wasm.heap8u();
      const length = Number(new DataView(heap.buffer, heap.byteOffset).getBigInt64(size, true));
      const bytes = this.read(image, length);
      this.run("sqlite3_free", image);
      return bytes;
    } finally {
      this.free(main);
      this.free(size);
    }
  }
}

let engine: Promise<SqliteEngine> | undefined;
/** Loads SQLite on first use; most apps never open a database. */
export function loadSqlite(): Promise<SqliteEngine> {
  engine ??= import("../../../web/vendor/sqlite3.mjs").then(
    async ({ default: initialize }) =>
      new SqliteEngine(await initialize({ print: () => undefined, printErr: () => undefined })),
  );
  return engine;
}
