const CHUNK = 65536;
// Darwin open(2) flags.
const O_WRONLY = 1, O_CREAT = 0x200, O_TRUNC = 0x400, FILE_MODE = 0o644;

// Whole-file reads and writes through the guest's libc, so paths resolve like the app's own.
export function guestFiles(cpu, heap, sys) {
  const call = (name, ...args) => sys.funcs[name](i => args[i] ?? 0);
  async function withPath(path, use) {
    const pointer = heap.string(path);
    try { return await use(pointer); } finally { heap.free(pointer); }
  }
  async function readFile(path) {
    return withPath(path, async pointer => {
      const fd = (await call('_open', pointer, 0)) | 0;
      if (fd < 0) return undefined;
      const buffer = heap.alloc(CHUNK), parts = [];
      try {
        for (;;) {
          const count = (await call('_read', fd, buffer, CHUNK)) | 0;
          if (count < 0) throw Error('Could not read SQLite database ' + path);
          if (!count) break;
          parts.push(cpu.read(buffer, count));
        }
      } finally { heap.free(buffer); await call('_close', fd); }
      const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      return bytes;
    });
  }
  async function writeFile(path, bytes) {
    await withPath(path, async pointer => {
      const fd = (await call('_open', pointer, O_WRONLY | O_CREAT | O_TRUNC, FILE_MODE)) | 0;
      if (fd < 0) throw Error('Could not write SQLite database ' + path);
      const buffer = heap.alloc(CHUNK);
      try {
        for (let offset = 0; offset < bytes.length;) {
          const size = Math.min(CHUNK, bytes.length - offset);
          cpu.write(buffer, bytes.subarray(offset, offset + size));
          const written = (await call('_write', fd, buffer, size)) | 0;
          if (written <= 0) throw Error('Could not write SQLite database ' + path);
          offset += written;
        }
      } finally { heap.free(buffer); await call('_close', fd); }
    });
  }
  return {readFile, writeFile};
}
