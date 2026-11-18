import {sqliteImports} from '../src/runtime/sqlite/imports.ts';
import {loadSqlite} from '../src/runtime/sqlite/engine.ts';
import {read32, write32, readCStringBytes} from '../src/runtime/memory/guest-memory.ts';
import {guestFiles} from './guest-files.mjs';

// Guest SQLite databases are whole files in the app's sandbox, read and written through libc.
export function guestSqlite(cpu, heap, sys, nested, diagnostic) {
  const {readFile, writeFile} = guestFiles(cpu, heap, sys);
  return sqliteImports({
    read: p => read32(cpu, p), write: (p, v) => write32(cpu, p, v),
    readBytes: (p, n) => cpu.read(p, n), writeBytes: (p, bytes) => cpu.write(p, bytes),
    cString: p => readCStringBytes(cpu, p),
    allocate: n => { const p = heap.alloc(n); if (!p) throw Error('Guest heap exhausted in SQLite'); return p; },
    free: p => heap.free(p),
    readFile, writeFile,
    callGuest: (fn, args) => nested(fn, args),
    engine: loadSqlite,
    warn: (message, details) => diagnostic('warn', 'sqlite', message, details),
  });
}
