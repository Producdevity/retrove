import { read32, write32, type GuestMemory } from "../../memory/guest-memory";
import type { GuestArguments } from "../objc/host";
import { asciiBytes } from "./byte-string";
import { formatDarwin } from "./format";
import { wide } from "./format-text";
import { UINT32_MAX, type GuestHeap } from "./guest-imports";
import { Errno } from "./bsd-errno";
import { WORD_BYTES } from "../abi/scalars";

const STDOUT = 1;
const ELEMENT_BYTES = 1;
const Slot = { Third: 2, Fixed: 3, Plain: 2, Checked: 4, CheckedLimit: 5 } as const;

type Words = (index: number) => number;

/** The sprintf family: pure functions of guest memory and their arguments. */
export function bufferImports(cpu: GuestMemory) {
  const buffer = (
    pointer: number,
    size: number,
    template: number,
    words: Words,
    checked = false,
  ): number => {
    const value = formatDarwin(cpu, template, words);
    if (checked && value.length + 1 > size)
      throw new Error("Guest __sprintf_chk destination is too small");
    if (size) cpu.write(pointer, asciiBytes(value.slice(0, size - 1) + "\0"));
    return value.length;
  };
  const list =
    (ap: number): Words =>
    (i) =>
      read32(cpu, ap + i * WORD_BYTES);
  return {
    _snprintf: (a: GuestArguments) => buffer(a(0), a(1), a(Slot.Third), (i) => a(Slot.Fixed + i)),
    _vsnprintf: (a: GuestArguments) => buffer(a(0), a(1), a(Slot.Third), list(a(Slot.Fixed))),
    _sprintf: (a: GuestArguments) => buffer(a(0), UINT32_MAX, a(1), (i) => a(Slot.Plain + i)),
    ___sprintf_chk: (a: GuestArguments) =>
      buffer(a(0), a(Slot.Third), a(Slot.Fixed), (i) => a(Slot.Checked + i), true),
    ___snprintf_chk: (a: GuestArguments) =>
      buffer(
        a(0),
        Math.min(a(1), a(Slot.Fixed)),
        a(Slot.Checked),
        (i) => a(Slot.CheckedLimit + i),
        a(Slot.Fixed) < a(1),
      ),
    ___vsnprintf_chk: (a: GuestArguments) =>
      buffer(
        a(0),
        Math.min(a(1), a(Slot.Fixed)),
        a(Slot.Checked),
        list(a(Slot.CheckedLimit)),
        a(Slot.Fixed) < a(1),
      ),
    ___vsprintf_chk: (a: GuestArguments) =>
      buffer(a(0), a(Slot.Third), a(Slot.Fixed), list(a(Slot.Checked)), true),
    _vsprintf: (a: GuestArguments) => buffer(a(0), UINT32_MAX, a(1), list(a(Slot.Third))),
  };
}

interface FormatFiles {
  writeBytes: (fd: number, bytes: Uint8Array) => Promise<number>;
  _fwrite: (a: GuestArguments) => number | Promise<number>;
}

export function formatImports(
  cpu: GuestMemory,
  heap: Pick<GuestHeap, "alloc" | "free">,
  errno: number,
  files: FormatFiles,
  _log?: (message: string) => void,
) {
  const format = (template: number, words: Words) => formatDarwin(cpu, template, words);
  return {
    ...bufferImports(cpu),
    _printf: (a: GuestArguments) =>
      files.writeBytes(STDOUT, asciiBytes(format(a(0), (i) => a(1 + i)))),
    _wprintf: async (a: GuestArguments): Promise<number> => {
      const fmt = wide(cpu, a(0)),
        ptr = heap.alloc(fmt.length + 1);
      if (!ptr) {
        write32(cpu, errno, Errno.NoMemory);
        return -1;
      }
      try {
        cpu.write(ptr, asciiBytes(fmt + "\0"));
        const str = new TextDecoder().decode(asciiBytes(format(ptr, (i) => a(1 + i))));
        const bytes = new TextEncoder().encode(str);
        return (await files.writeBytes(STDOUT, bytes)) === bytes.length
          ? Array.from(str).length
          : -1;
      } finally {
        heap.free(ptr);
      }
    },
    _fprintf: async (a: GuestArguments): Promise<number> => {
      const stream = a(0),
        s = format(a(1), (i) => a(Slot.Plain + i));
      if (!s.length) return 0;
      const ptr = heap.alloc(s.length);
      if (!ptr) {
        write32(cpu, errno, Errno.NoMemory);
        return -1;
      }
      try {
        cpu.write(ptr, asciiBytes(s));
        const argv = [ptr, ELEMENT_BYTES, s.length, stream];
        return (await files._fwrite((i) => argv[i] ?? 0)) === s.length ? s.length : -1;
      } finally {
        heap.free(ptr);
      }
    },
  };
}
