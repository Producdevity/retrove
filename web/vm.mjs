import {write32} from './memory.mjs';

const PAGE = 4096;
const LOW = 0x41000000, HIGH = 0x6fc00000; // Between the import gates and main stack.
const SHARED = 1, PRIVATE = 2, FIXED = 0x10, ANON = 0x1000;
const pageUp = n => Math.ceil(n / PAGE) * PAGE;

export function virtualMemoryImports(cpu, errno) {
  let areas = []; // Sorted, disjoint half-open anonymous mappings.
  function fail(code) { write32(cpu, errno, code); return 0xffffffff; }
  function gap(from, size) {
    let start = Math.max(LOW, from);
    for (const area of areas) {
      if (area.end <= start) continue;
      if (area.start - start >= size) break;
      start = area.end;
    }
    return start + size <= HIGH ? start : 0;
  }
  function unmap(start, end) {
    const remaining = [];
    for (const area of areas) {
      const left = Math.max(area.start, start), right = Math.min(area.end, end);
      if (left >= right) { remaining.push(area); continue; }
      cpu.unmap(left, right - left);
      if (area.start < left) remaining.push({start: area.start, end: left});
      if (right < area.end) remaining.push({start: right, end: area.end});
    }
    areas = remaining;
  }
  return {
    _mmap: a => {
      const address = a(0), size = pageUp(a(1)), perms = a(2), flags = a(3);
      if (!size || (perms & ~7) || (flags & ~0x1253) || ![PRIVATE, SHARED].includes(flags & 3) ||
          (a(5) & (PAGE - 1)) || (a(6) | 0) < 0) return fail(22); // EINVAL
      if (!(flags & ANON)) return fail(19); // ENODEV: device has no file mapping support
      let start;
      if (flags & FIXED) {
        if (address % PAGE || address < LOW || address + size > HIGH) return fail(22);
        start = address;
        unmap(start, start + size);
      } else start = gap(pageUp(address), size) || gap(LOW, size);
      if (!start) return fail(12); // ENOMEM
      try { cpu.map(start, size, perms); }
      catch (error) {
        if (error instanceof WebAssembly.RuntimeError) throw error;
        return fail(12);
      }
      const i = areas.findIndex(area => area.start > start);
      areas.splice(i < 0 ? areas.length : i, 0, {start, end: start + size});
      return start;
    },
    _munmap: a => {
      const start = a(0), size = pageUp(a(1));
      if (!size || start % PAGE || start < LOW || start + size > HIGH) return fail(22);
      unmap(start, start + size);
      return 0;
    }
  };
}
