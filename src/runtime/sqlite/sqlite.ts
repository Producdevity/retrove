import type { GuestMemory, Heap } from "../memory/guest-memory";
import { read32, write32, readCStringBytes } from "../memory/guest-memory";
import type { Diagnostic } from "../ios/package/ipa";
import { sqliteImports, type SqliteHost } from "./imports";
import type { SqliteImports } from "./statements";
import { loadSqlite } from "./engine";
import { guestFiles, type GuestLibc } from "./guest-files";

/** Guest SQLite databases are whole files in the app's sandbox, read and written through libc. */
export function guestSqlite(
  cpu: GuestMemory,
  heap: Pick<Heap, "alloc" | "free" | "string">,
  sys: GuestLibc,
  nested: SqliteHost["callGuest"],
  diagnostic: Diagnostic,
): SqliteImports {
  const { readFile, writeFile } = guestFiles(cpu, heap, sys);
  return sqliteImports({
    read: (pointer) => read32(cpu, pointer),
    write: (pointer, value) => write32(cpu, pointer, value),
    readBytes: (pointer, length) => cpu.read(pointer, length),
    writeBytes: (pointer, bytes) => cpu.write(pointer, bytes),
    cString: (pointer) => readCStringBytes(cpu, pointer),
    allocate: (bytes) => {
      const pointer = heap.alloc(bytes);
      if (!pointer) throw new Error("Guest heap exhausted in SQLite");
      return pointer;
    },
    free: (pointer) => heap.free(pointer),
    readFile,
    writeFile,
    callGuest: (implementation, args) => nested(implementation, args),
    engine: loadSqlite,
    warn: (message, details) => diagnostic("warn", "sqlite", message, details),
  });
}
