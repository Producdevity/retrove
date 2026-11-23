import {
  fill,
  move,
  readCStringBytes,
  type GuestMemory,
  type Heap,
} from "../../../memory/guest-memory";
import { write32 } from "../../../memory/guest-memory";
import { Errno } from "../files/errno";
import { Argument } from "../../objc/host";
import type { SystemImport } from "./types";

const MIN_ALIGNMENT = 4;
const DEFAULT_ALIGNMENT = 16;
const COMPARE_CHUNK = 16384;

function compareBytes(left: Uint8Array, right: Uint8Array, count: number): number {
  for (let i = 0; i < count; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function resize(cpu: GuestMemory, heap: Heap, address: number, size: number): number {
  if (!address) return heap.alloc(size);
  const old = heap.live.get(address);
  if (old === undefined) throw new Error("Invalid guest realloc");
  if (size && size <= old) return address;
  const pointer = heap.alloc(size);
  if (pointer) {
    move(cpu, pointer, address, Math.min(old, size));
    heap.free(address);
  }
  return pointer;
}

export function allocationImports(cpu: GuestMemory, heap: Heap): Record<string, SystemImport> {
  const alloc: SystemImport = (a) => heap.alloc(a(0));
  const del: SystemImport = (a) => {
    heap.free(a(0));
  };
  return {
    _malloc: alloc,
    _free: del,
    _calloc: (a) => heap.zero(a(0) * a(1)),
    _realloc: (a) => resize(cpu, heap, a(0), a(1)),
    _posix_memalign: (a) => {
      const alignment = a(1);
      if (alignment < MIN_ALIGNMENT || alignment & (alignment - 1)) return Errno.Invalid;
      const pointer = heap.alloc(a(Argument.Third), Math.max(DEFAULT_ALIGNMENT, alignment));
      if (!pointer) return Errno.NoMemory;
      write32(cpu, a(0), pointer);
      return 0;
    },
    __Znwj: alloc,
    __Znaj: alloc,
    __ZdlPv: del,
    __ZdaPv: del,
    _malloc_size: (a) => heap.live.get(a(0)) || 0,
  };
}

export function byteImports(cpu: GuestMemory): Record<string, SystemImport> {
  return {
    _memcpy: (a) => {
      move(cpu, a(0), a(1), a(Argument.Third));
      return a(0);
    },
    _memset: (a) => {
      fill(cpu, a(0), a(1), a(Argument.Third));
      return a(0);
    },
    _bzero: (a) => fill(cpu, a(0), 0, a(1)),
    ___memcpy_chk: (a) => {
      if (a(Argument.Third) > a(Argument.Fourth))
        throw Error("Guest __memcpy_chk overflows its destination");
      move(cpu, a(0), a(1), a(Argument.Third));
      return a(0);
    },
    ___memset_chk: (a) => {
      if (a(Argument.Third) > a(Argument.Fourth))
        throw Error("Guest __memset_chk overflows its destination");
      fill(cpu, a(0), a(1), a(Argument.Third));
      return a(0);
    },
    _memcmp: (a) => {
      let done = 0;
      while (done < a(Argument.Third)) {
        const count = Math.min(a(Argument.Third) - done, COMPARE_CHUNK);
        const difference = compareBytes(
          cpu.read(a(0) + done, count),
          cpu.read(a(1) + done, count),
          count,
        );
        if (difference) return difference;
        done += count;
      }
      return 0;
    },
  };
}

export function stringBlockImports(cpu: GuestMemory, heap: Heap): Record<string, SystemImport> {
  return {
    _strdup: (a) => {
      const text = readCStringBytes(cpu, a(0));
      const pointer = heap.alloc(text.length + 1);
      if (pointer) {
        cpu.write(pointer, text);
        cpu.write(pointer + text.length, Uint8Array.of(0));
      }
      return pointer;
    },
    _strcmp: (a) => {
      const left = readCStringBytes(cpu, a(0)),
        right = readCStringBytes(cpu, a(1));
      return compareBytes(left, right, Math.max(left.length, right.length, 1));
    },
  };
}
