import {read32, readString, write32} from './memory.mjs';

const PAGE = 4096, HOST = 1;
export const TASK = 2;
// The emulated iPhone 5 has 1 GiB RAM and runs on one cooperative guest processor.
const MEMORY = 1024 ** 3;
const text = new TextEncoder();
const numericMib = new Map([[1, 'hw.machine'], [3, 'hw.ncpu'], [5, 'hw.physmem'], [6, 'hw.usermem'],
  [7, 'hw.pagesize'], [24, 'hw.memsize']]);

export function darwinSystem(cpu, heap, errno) {
  const limits = new Map([[3, [4n << 20n, 4n << 20n]], [8, [256n, 10240n]]]);
  const env = new Map();
  const failure = code => { write32(cpu, errno, code); return -1; };
  const model = text.encode('iPhone5,1\0');
  const read64 = address => BigInt(read32(cpu, address)) | (BigInt(read32(cpu, address+4)) << 32n);
  function write64(address, n) { write32(cpu, address, Number(n & 0xffffffffn)); write32(cpu, address+4, Number(n >> 32n)); }
  function ctl(name, output, count, replacement, replacementSize) {
    if (replacement || replacementSize) return failure(1);
    let bytes;
    if (name === 'hw.machine') bytes = model;
    else {
      let value;
      if (['hw.ncpu','hw.physicalcpu','hw.logicalcpu','hw.activecpu'].includes(name)) value = 1;
      else if (name === 'hw.pagesize') value = PAGE;
      else if (name === 'hw.memsize' || name === 'hw.physmem') value = MEMORY;
      else if (name === 'hw.usermem') value = Math.max(0, MEMORY - cpu.mappedBytes);
      else return failure(2);
      bytes = new Uint8Array(name === 'hw.memsize' ? 8 : 4);
      new DataView(bytes.buffer).setUint32(0, value, true);
    }
    if (!count) return output ? failure(14) : 0;
    const size = output ? Math.min(bytes.length, read32(cpu, count)) : bytes.length;
    if (output && size) cpu.write(output, bytes.subarray(0, size));
    write32(cpu, count, size);
    return size === bytes.length ? 0 : failure(12);
  }
  function stats(a, port, flavor, count, values) {
    if (a(0) !== port || a(1) !== flavor || !a(2) || !a(3) || read32(cpu,a(3)) < count) return 4;
    const buffer = new Uint8Array(count*4), view = new DataView(buffer.buffer);
    for (const [index, value] of values) view.setUint32(index*4, value, true);
    cpu.write(a(2), buffer);
    write32(cpu,a(3),count);
    return 0;
  }
  return {
    _sysconf: a => {
      switch (a(0)) {
        case 1: return 262144; // ARG_MAX
        case 2: return 0; // No child process facility.
        case 3: return 100; // CLK_TCK
        case 4: return 16; // NGROUPS_MAX
        case 5: return Number(limits.get(8)[0]); // OPEN_MAX
        case 29: return PAGE;
        case 57: case 58: return 1;
        default: return failure(22);
      }
    },
    _sysctlbyname: a => a(0) ? ctl(readString(cpu,a(0)), a(1), a(2), a(3), a(4)) : failure(14),
    _sysctl: a => {
      if (!a(0)) return failure(14);
      if (a(1) !== 2 || read32(cpu,a(0)) !== 6) return failure(2);
      return ctl(numericMib.get(read32(cpu,a(0)+4)), a(2), a(3), a(4), a(5));
    },
    _mach_host_self: () => HOST,
    _host_page_size: a => {
      if (a(0) !== HOST || !a(1)) return 4;
      write32(cpu,a(1),PAGE); return 0;
    },
    _host_statistics: a => {
      const pages = Math.ceil(cpu.mappedBytes/PAGE);
      return stats(a, HOST, 2, 15, [[0,Math.max(0,MEMORY/PAGE-pages)], [1,pages]]);
    },
    _task_info: a => stats(a, TASK, 4, 8, [[1,cpu.mappedBytes], [2,cpu.mappedBytes], [7,1]]),
    _thread_policy_set: a => (!a(0) || a(1) !== 2 || !a(2) || a(3) !== 4) ? 4 : 46,
    _getdtablesize: () => Number(limits.get(8)[0]),
    _getrlimit: a => {
      const limit = limits.get(a(0) & 0xfff);
      if (!a(1)) return failure(14);
      if (!limit) return failure(22);
      write64(a(1),limit[0]); write64(a(1)+8,limit[1]); return 0;
    },
    _setrlimit: a => {
      const key = a(0) & 0xfff, current = limits.get(key);
      if (!a(1)) return failure(14);
      if (!current) return failure(22);
      const soft = read64(a(1)), hard = read64(a(1)+8);
      if (soft > hard) return failure(22);
      if (hard > current[1]) return failure(1);
      if (key === 3 && soft !== current[0]) return failure(45);
      limits.set(key,[soft,hard]); return 0;
    },
    _getenv: a => {
      const key = readString(cpu,a(0));
      const value = {HOME:'/', TMPDIR:'/tmp/', LANG:'C'}[key];
      if (typeof value !== 'string') return 0;
      if (!env.has(key)) env.set(key,heap.string(value));
      return env.get(key);
    },
    _gethostname: a => {
      const bytes = text.encode('localhost\0');
      if (!a(0)) return failure(14);
      cpu.write(a(0), bytes.subarray(0,a(1)));
      return a(1) < bytes.length ? failure(63) : 0;
    }
  };
}
