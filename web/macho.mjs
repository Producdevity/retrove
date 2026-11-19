import {GuestLayout} from '../src/runtime/memory/guest-layout.ts';
import {classicRelocations} from "../src/runtime/ios/macho/classic-relocations.ts";
import {SymbolIndex} from "../src/runtime/diagnostics/symbol-index.ts";
const PAGE = 4096;
const ARM = 12;
const MAX32 = 0xffffffff;
const LC = {
  segment: 0x1, symtab: 0x2, unixthread: 0x5, dysymtab: 0xb, dylib: 0xc,
  weakDylib: 0x80000018, reexport: 0x8000001f, upward: 0x80000023,
  encryption: 0x21, dyldInfo: 0x22, dyldInfoOnly: 0x80000022, main: 0x80000028,
  chainedFixups: 0x80000034, exportsTrie: 0x80000033,
};
const decoder = new TextDecoder('utf-8', { fatal: true });

function requireFormat(valid, message) {
  if (!valid) throw new Error('Mach-O: ' + message);
}

function sub(bytes, at, size, what) {
  requireFormat(Number.isSafeInteger(at) && at >= 0 && Number.isSafeInteger(size) &&
    size >= 0 && at <= bytes.length && size <= bytes.length - at, 'invalid ' + what + ' range');
  return bytes.subarray(at, at + size);
}

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function fixed(bytes) {
  const end = bytes.indexOf(0);
  return decoder.decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function readCString(bytes, start) {
  const end = bytes.indexOf(0, start);
  requireFormat(start >= 0 && start < bytes.length && end >= start && end - start <= 65536, 'invalid symbol or path');
  return { value: decoder.decode(bytes.subarray(start, end)), end: end + 1 };
}

function selectSlice(input) {
  requireFormat(input instanceof Uint8Array && input.length >= 4, 'truncated executable');
  const d = view(input);
  if (d.getUint32(0, true) === 0xfeedface) return input;
  const magic = d.getUint32(0);
  requireFormat([0xcafebabe, 0xbebafeca].includes(magic), 'expected 32-bit ARM Mach-O executable');
  const le = magic === 0xbebafeca;
  sub(input, 0, 8, 'fat header');
  const count = d.getUint32(4, le);
  sub(input, 8, count * 20, 'fat architecture table');
  let fallback;
  for (let i = 0; i < count; i++) {
    const at = 8 + i * 20;
    if (d.getUint32(at, le) !== ARM) continue;
    const slice = sub(input, d.getUint32(at + 8, le), d.getUint32(at + 12, le), 'ARM slice');
    if ((d.getUint32(at + 4, le) & 0xffffff) === 9) return slice;
    fallback ??= slice;
  }
  requireFormat(fallback, 'no 32-bit ARM slice');
  return fallback;
}

class Cursor {
  constructor(bytes, offset = 0) { this.bytes = bytes; this.offset = offset; }
  byte() {
    requireFormat(this.offset < this.bytes.length, 'truncated dyld stream');
    return this.bytes[this.offset++];
  }
  leb(signed = false, wrap32 = false) {
    let bits = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const b = this.byte();
      const value = BigInt(b & 127);
      requireFormat(shift !== 63n || (signed ? value === 0n || value === 127n : value <= 1n), 'oversized dyld integer');
      bits |= value << shift;
      if (!(b & 128)) {
        if (signed && (b & 64)) bits -= 1n << (shift + 7n);
        if (wrap32) return Number(BigInt.asUintN(32, bits));
        requireFormat(bits <= 0xffffffffn && bits >= -0x80000000n, 'dyld value exceeds 32 bits');
        return Number(bits);
      }
    }
    throw new Error('Mach-O: invalid dyld integer');
  }
  string() {
    const { value, end } = readCString(this.bytes, this.offset);
    this.offset = end;
    return value;
  }
}

function parseSegment(cmd, d) {
  requireFormat(cmd.length >= 56, 'truncated segment');
  const u = at => d.getUint32(at, true);
  const segment = {
    name: fixed(cmd.subarray(8, 24)), address: u(24), size: u(28),
    fileOffset: u(32), fileSize: u(36), maxProtection: u(40), protection: u(44), sections: [],
  };
  const { name, address, size, fileSize, fileOffset, protection, maxProtection } = segment;
  const sectionCount = u(48);
  requireFormat(56 + sectionCount * 68 === cmd.length, 'invalid section count');
  requireFormat(address % PAGE === 0 && size % PAGE === 0 && address + size <= MAX32 + 1 &&
    size > 0 && fileSize <= size && maxProtection <= 7 && !(protection & ~maxProtection) && u(52) === 0, 'invalid segment ' + name);
  if (name === '__PAGEZERO') {
    requireFormat(address === 0 && fileSize === 0 && maxProtection === 0 && !sectionCount, 'invalid __PAGEZERO');
  } else requireFormat(address >= PAGE, 'null page mapped by ' + name);
  for (let i = 0; i < sectionCount; i++) {
    const at = 56 + i * 68;
    const s = { name: fixed(cmd.subarray(at, at + 16)), address: u(at + 32), size: u(at + 36),
      fileOffset: u(at + 40), type: u(at + 56) & 255, reserved1: u(at + 60), reserved2: u(at + 64) };
    const rel = s.address - address;
    requireFormat(fixed(cmd.subarray(at + 16, at + 32)) === name && rel >= 0 && rel + s.size <= size &&
      u(at + 44) <= 31 && s.address % 2 ** u(at + 44) === 0, 'invalid section ' + s.name);
    requireFormat(u(at + 52) === 0, 'section relocations unsupported in ' + s.name);
    if (![1, 0xc, 0x12].includes(s.type)) {
      requireFormat(s.fileOffset === fileOffset + rel && rel + s.size <= fileSize, 'invalid file range for ' + s.name);
    }
    segment.sections.push(s);
  }
  return segment;
}

function executable(segments, target) {
  const thumb = target % 2;
  const pc = target - thumb;
  const width = thumb ? 2 : 4;
  return Number.isInteger(target) && pc % width === 0 &&
    segments.some(s => (s.protection & 4) && pc >= s.address && pc + width <= s.address + s.fileSize);
}

export function fixupStream(bytes, image, mode) {
  if (!bytes.length) return;
  const cursor = new Cursor(bytes);
  const rebase = mode === 'rebase';
  let seg, offset, name, ordinal, kind, flags, addend, lazyOffset=0;
  function reset() {
    seg = null; offset = 0; name = ''; ordinal = 0; kind = 1; flags = 0; addend = 0;
  }
  reset();
  function advance(amount) { offset = (offset + amount) >>> 0; }
  function segment(index) {
    seg = image.segments[index];
    offset = cursor.leb();
    requireFormat(seg && seg.name !== '__PAGEZERO' && offset <= seg.size, 'invalid fixup segment');
  }
  function repeat(count, stride) {
    if (!count) return;
    const out = rebase ? image.rebases : image.imports;
    requireFormat(seg && offset % 4 === 0 && (stride % 4 === 0 || count === 1) &&
      offset + 4 + (count - 1) * stride <= seg.size && out.length + count <= 2_000_000, 'fixup outside segment or limit');
    requireFormat(rebase || (name && ordinal <= image.dylibs.length && ordinal >= -3), 'invalid bind symbol or ordinal');
    for (let i = 0; i < count; i++) {
      const address = seg.address + offset;
      if (rebase) out.push(address);
      else out.push({ address, name, library: image.dylibs[ordinal - 1] ?? null, ordinal, kind,
        weak: Boolean(flags & 1) || ordinal === -3, addend, mode, ...(mode === 'lazy' ? {lazyOffset}: {}) });
      advance(stride);
    }
  }
  while (cursor.offset < bytes.length) {
    const b = cursor.byte(), op = b >> 4, imm = b & 15;
    if (!op) {
      requireFormat(!imm, 'invalid dyld DONE');
      if (mode === 'lazy' && cursor.offset < bytes.length) { lazyOffset=cursor.offset; reset(); continue; }
      requireFormat(bytes.subarray(cursor.offset).every(byte => byte === 0), 'trailing dyld opcodes');
      return;
    }
    if (rebase) {
      switch (op) {
        case 1: requireFormat(imm >= 1 && imm <= 3, 'unknown rebase type'); break;
        case 2: segment(imm); break;
        case 3: advance(cursor.leb(false, true)); break;
        case 4: advance(imm * 4); break;
        case 5: repeat(imm, 4); break;
        case 6: repeat(cursor.leb(), 4); break;
        case 7: repeat(1, 4 + cursor.leb(false, true)); break;
        case 8: repeat(cursor.leb(), 4 + cursor.leb(false, true)); break;
        default: throw new Error('Mach-O: unsupported rebase opcode ' + op);
      }
    } else {
      switch (op) {
        case 1: ordinal = imm; break;
        case 2: ordinal = cursor.leb(); break;
        case 3: ordinal = imm ? imm - 16 : 0; break;
        case 4:
          requireFormat(!(imm & ~9), 'invalid bind flags');
          flags = imm; name = cursor.string();
          requireFormat(name.length, 'empty import name'); break;
        case 5:
          requireFormat(imm >= 1 && imm <= 3, 'unknown bind type'); kind = imm; break;
        case 6: addend = cursor.leb(true); break;
        case 7: segment(imm); break;
        case 8: advance(cursor.leb(false, true)); break;
        case 9: repeat(1, 4); break;
        case 10: repeat(1, 4 + cursor.leb(false, true)); break;
        case 11: repeat(1, (imm + 1) * 4); break;
        case 12: repeat(cursor.leb(), 4 + cursor.leb(false, true)); break;
        default: throw new Error('Mach-O: unsupported bind opcode ' + op);
      }
    }
  }
  // dyld stops at the end of the opcode bytes as well as at DONE; some linkers omit the final DONE.
}

function exportAddress(bytes, base, name) {
  if (!bytes?.length || !name) return null;
  let offset = 0, consumed = 0;
  while (true) {
    const node = new Cursor(bytes, offset);
    const terminalSize = node.leb();
    const terminal = sub(bytes, node.offset, terminalSize, 'export trie');
    if (consumed === name.length) {
      if (!terminal.length) return null;
      const value = new Cursor(terminal), flags = value.leb();
      requireFormat(!(flags & ~6), 'unsupported export type for ' + name);
      const address = (flags & 2 ? 0 : base) + value.leb();
      requireFormat(value.offset === terminal.length && address <= MAX32, 'invalid export ' + name);
      return address;
    }
    node.offset += terminalSize;
    const children = node.byte();
    let match = false;
    for (let i = 0; i < children; i++) {
      const edge = node.string(), next = node.leb();
      requireFormat(edge.length > 0 && next > 0 && next < bytes.length, 'invalid export trie edge');
      if (name.startsWith(edge, consumed)) {
        offset = next; consumed += edge.length; match = true; break;
      }
    }
    if (!match) return null;
  }
}

function readIndirect(image, sym, dysym, flags) {
  if (!sym || !dysym) return;
  const u = (d, at) => d.getUint32(at, true);
  const symbols = view(sub(image.bytes, u(sym, 8), u(sym, 12) * 12, 'symbol table'));
  const strings = sub(image.bytes, u(sym, 16), u(sym, 20), 'string table');
  const relocations = view(sub(image.bytes, u(dysym, 64), u(dysym, 68) * 8, 'external relocations'));
  for(const binding of classicRelocations({...image, flags, symbols, strings, relocations}))image.imports.push(binding);
  const indices = view(sub(image.bytes, u(dysym, 56), u(dysym, 60) * 4, 'indirect symbols'));
  for (const seg of image.segments) {
    for (const s of seg.sections) {
      if (s.type !== 6 && s.type !== 7) continue;
      requireFormat(s.size % 4 === 0 && s.reserved1 * 4 + s.size <= indices.byteLength, 'invalid indirect section');
      for (let pos = 0; pos < s.size; pos += 4) {
        const index = u(indices, s.reserved1 * 4 + pos);
        if (index & 0xc0000000) continue;
        const at = index * 12;
        requireFormat(at + 12 <= symbols.byteLength, 'invalid symbol index');
        const desc = symbols.getUint16(at + 6, true), raw = desc >>> 8;
        const ordinal = raw > 0xfd ? raw - 0x100 : raw;
        requireFormat(ordinal <= image.dylibs.length, 'invalid indirect symbol ordinal');
        const name = readCString(strings, u(symbols, at)).value;
        const address = s.address + pos;
        requireFormat(name && image.imports.length < 2_000_000, 'invalid indirect import');
        image.imports.push({ address, name, ordinal, library: image.dylibs[ordinal - 1] ?? null, kind: 1,
          weak: Boolean(desc & 0x40), addend: 0, mode: s.type === 6 ? 'normal' : 'lazy' });
      }
    }
  }
}

function symbolLookup(image, command) {
  if (!command) return () => undefined;
  const field = at => command.getUint32(at, true);
  const list = sub(image.bytes, field(8), 12 * field(12), 'symbol table');
  const names = sub(image.bytes, field(16), field(20), 'string table');
  const sections = image.segments.flatMap(segment => segment.sections);
  let index;
  return target => (index ??= new SymbolIndex(list, names, sections)).lookup(target);
}

export function parseMachO(input) {
  const bytes = selectSlice(input);
  sub(bytes, 0, 28, 'header');
  const d = view(bytes), u = at => d.getUint32(at, true);
  requireFormat(u(0) === 0xfeedface && u(4) === ARM && u(12) === 2, 'expected 32-bit ARM executable');
  const commands = sub(bytes, 28, u(20), 'load commands');
  requireFormat(u(16) <= commands.length / 8, 'invalid load command count');
  const image = { bytes, segments: [], initializers: [], dylibs: [], imports: [], rebases: [], subtype: u(8) & 0xffffff };
  let off = 0, entryOffset, entryPC, dyld, exportBytes, sym, dysym;
  for (let i = 0; i < u(16); i++) {
    const head = view(sub(commands, off, 8, 'load command header'));
    const type = head.getUint32(0, true), size = head.getUint32(4, true);
    requireFormat(size >= 8 && size % 4 === 0, 'invalid load command size');
    const cmd = sub(commands, off, size, 'load command'), cd = view(cmd);
    const w = at => { requireFormat(at + 4 <= size, 'truncated load command'); return cd.getUint32(at, true); };
    off += size;
    switch (type) {
      case LC.segment: {
        const seg = parseSegment(cmd, cd);
        sub(bytes, seg.fileOffset, seg.fileSize, 'segment ' + seg.name);
        image.segments.push(seg);
        break;
      }
      case LC.dylib: case LC.weakDylib: case LC.reexport: case LC.upward: {
        const at = w(8);
        requireFormat(at >= 24, 'invalid dylib name');
        image.dylibs.push(readCString(cmd, at).value); break;
      }
      case LC.encryption:
        requireFormat(w(16) === 0, 'encrypted executable (cryptid is nonzero)'); break;
      case LC.main:
        requireFormat(entryOffset === undefined && size >= 24 && w(12) === 0, 'invalid main command');
        entryOffset = w(8); break;
      case LC.unixthread:
        requireFormat(entryPC === undefined && w(8) === 1 && w(12) === 17 && size === 84, 'unsupported ARM thread state');
        entryPC = (w(76) | ((w(80) & 32) ? 1 : 0)) >>> 0; break;
      case LC.dyldInfo: case LC.dyldInfoOnly:
        requireFormat(!dyld && size === 48, 'invalid dyld info'); dyld = cd; break;
      case LC.exportsTrie:
        exportBytes = sub(bytes, w(8), w(12), 'export trie'); break;
      case LC.chainedFixups: throw new Error('Mach-O: chained fixups are unsupported');
      case LC.symtab: requireFormat(size >= 24 && !sym, 'invalid symbol table'); sym = cd; break;
      case LC.dysymtab: requireFormat(size >= 80 && !dysym, 'invalid dynamic symbol table'); dysym = cd; break;
    }
  }
  requireFormat(off === commands.length, 'load command sizes disagree');
  const sorted = [...image.segments].sort((a, b) => a.address - b.address);
  const baseSegment = sorted.find(seg => seg.fileSize >= 28 && seg.fileOffset === 0);
  requireFormat(baseSegment, 'no mapped Mach-O header');
  let end = 0, mapped = 0;
  for (const seg of sorted) {
    requireFormat(seg.address >= end, 'overlapping guest segments');
    end = seg.address + seg.size;
    if (seg.name !== '__PAGEZERO') mapped += seg.size;
    for (const s of seg.sections) {
      if (s.type !== 9) continue;
      requireFormat(s.address % 4 === 0 && s.size % 4 === 0 && image.initializers.length + s.size / 4 <= 262144, 'invalid initializer table');
      for (let p = 0; p < s.size; p += 4) image.initializers.push(s.address + p);
    }
  }
  requireFormat(mapped <= 512 * 1024 * 1024, 'image exceeds the 512 MiB mapped image budget');
  if (entryOffset !== undefined) {
    requireFormat(entryPC === undefined, 'ambiguous entry point');
    const code = entryOffset - (entryOffset % 2);
    const seg = sorted.find(s => s.protection & 4 && code >= s.fileOffset && code < s.fileOffset + s.fileSize);
    requireFormat(seg, 'entry outside executable segment');
    image.entry = seg.address + entryOffset - seg.fileOffset; image.entryKind = 'main';
  } else { image.entry = entryPC; image.entryKind = 'thread'; }
  requireFormat(executable(sorted, image.entry), 'invalid ARM entry point');
  if (dyld) {
    const stream = n => sub(bytes, dyld.getUint32(n, true), dyld.getUint32(n + 4, true), 'dyld stream');
    for (const [mode, at] of [['rebase', 8], ['normal', 16], ['lazy', 32], ['weak', 24]]) {
      fixupStream(stream(at), image, mode);
    }
    exportBytes ??= stream(40);
  } else readIndirect(image, sym, dysym, u(24));
  image.findExport = name => exportAddress(exportBytes, baseSegment.address, name);
  image.symbolAt = symbolLookup(image, sym);
  return image;
}

export function loadMachO(image, memory, resolveImport) {
  // There is no slide: encoded local pointers and PC-relative references stay valid.
  const writes = [], lazyTargets = new Map();
  for (const binding of image.imports) {
    let target = null;
    if (binding.ordinal <= 0 || binding.mode === 'weak') target = image.findExport(binding.name);
    if (target == null && binding.mode === 'weak') continue; // retain the reference to the guest's definition
    if (target == null) target = resolveImport(binding);
    if (target == null && binding.weak) target = 0;
    requireFormat(Number.isInteger(target) && target >= 0 && target <= MAX32,
      'unresolved import ' + binding.name + (binding.library ? ' from ' + binding.library : ''));
    let value = target + binding.addend;
    if (binding.kind === 3) value -= binding.address + 4;
    writes.push([binding.address, value >>> 0]);
    if(binding.lazyOffset !== undefined)lazyTargets.set(binding.lazyOffset,{slot:binding.address,target:(target+binding.addend)>>>0,value:value>>>0});
  }
  for (const s of image.segments) {
    if (s.name === '__PAGEZERO') continue;
    requireFormat(s.address + s.size <= GuestLayout.HeapBase,
      'segment ' + s.name + ' ends above the guest heap at 0x' + GuestLayout.HeapBase.toString(16));
    memory.map(s.address, s.size, s.protection);
    if (s.fileSize) memory.write(s.address, image.bytes.subarray(s.fileOffset, s.fileOffset + s.fileSize));
  }
  for (const [at, value] of writes) memory.write32(at, value);
  const initializers = image.initializers.map(at => memory.read32(at));
  for (const init of initializers) requireFormat(executable(image.segments, init), 'initializer outside executable code');
  return { entry: image.entry, entryKind: image.entryKind, initializers, lazyTargets };
}

// Write argc, argv, envp and apple[] into caller-owned guest memory.
// rawStack is also usable for a legacy LC_UNIXTHREAD entry.
export function prepareStartup(memory, stackTop, path) {
  requireFormat(Number.isInteger(stackTop) && stackTop > 0 && stackTop <= MAX32, 'invalid guest stack');
  requireFormat(typeof path === 'string' && !path.includes('\0'), 'invalid executable path');
  const encoded = new TextEncoder().encode(path + '\0');
  requireFormat(encoded.length <= PAGE && stackTop >= encoded.length + 64, 'executable path exceeds stack');
  const stringAt = stackTop - encoded.length;
  const rawStack = Math.floor((stringAt - 24) / 16) * 16;
  memory.write(stringAt, encoded);
  const argv = rawStack + 4, envp = rawStack + 12, apple = rawStack + 16;
  for (const [index, value] of [1, stringAt, 0, 0, stringAt, 0].entries()) memory.write32(rawStack + index * 4, value);
  return { rawStack, args: [1, argv, envp, apple, 0] };
}
