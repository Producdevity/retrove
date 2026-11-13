import {fill, move, readCStringBytes, write32} from './memory.mjs';

const PAGE = 4096;
const ADDRESS_SPACE = 0x100000000;

function asciiLower(c) {
  return c >= 65 && c <= 90 ? c + 32 : c;
}

function asciiUpper(c) {
  return c >= 97 && c <= 122 ? c - 32 : c;
}

function runeFlags(c) {
  if (c < 0 || c > 127) return 0;
  const upper = c >= 65 && c <= 90, lower = c >= 97 && c <= 122;
  const alpha = upper || lower, digit = c >= 48 && c <= 57;
  const print = c >= 32 && c < 127, graphic = print && c !== 32;
  const hex = digit || (asciiLower(c) >= 97 && asciiLower(c) <= 102);
  let flags = 0;
  if (alpha) flags |= 0x100;
  if (c < 32 || c === 127) flags |= 0x200;
  if (digit) flags |= 0x400;
  if (graphic) flags |= 0x800;
  if (lower) flags |= 0x1000;
  if (graphic && !alpha && !digit) flags |= 0x2000;
  if (c === 32 || (c >= 9 && c <= 13)) flags |= 0x4000;
  if (upper) flags |= 0x8000;
  if (hex) flags |= 0x10000 | (digit ? c - 48 : asciiLower(c) - 87);
  if (c === 32 || c === 9) flags |= 0x20000;
  if (print) flags |= 0x40000;
  return flags;
}

// Darwin ARMv7 ctype.h reads these tables directly when the character fits in a byte.
export function defaultRuneLocale(cpu, heap) {
  const bytes = new Uint8Array(3164), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RuneMagANONE'));
  view.setUint32(48, 0xfffd, true);
  for (let c = 0; c < 256; c++) {
    view.setUint32(52 + 4 * c, runeFlags(c), true);
    view.setUint32(1076 + 4 * c, asciiLower(c), true);
    view.setUint32(2100 + 4 * c, asciiUpper(c), true);
  }
  const addr = heap.alloc(bytes.length);
  if (!addr) throw Error('Guest heap exhausted while creating the default rune locale');
  cpu.write(addr, bytes);
  return addr;
}

// Round the significand to binary64 before applying the power of two, including
// subnormals. Sixteen hex digits cover the mantissa plus all rounding bits.
function hexFloat(source) {
  const [mantissa, exponent] = source.slice(2).toLowerCase().split('p');
  const point = mantissa.indexOf('.');
  const digits = mantissa.replace('.', '').replace(/^0+/, '');
  if (!digits.length) return 0;
  const significant = digits.slice(0, 16), sticky = /[1-9a-f]/.test(digits.slice(16));
  const integer = BigInt('0x' + significant);
  const fraction = point < 0 ? 0 : mantissa.length - point - 1;
  const scale = Number(exponent || 0) + 4 * (digits.length - significant.length - fraction);
  const e = integer.toString(2).length - 1 + scale;
  if (e > 1023) return Infinity;
  if (e < -1075) return 0;
  const unit = Math.max(-1074, e - 52), shift = BigInt(unit - scale);
  let rounded = integer >> shift;
  if (shift > 0n) {
    const remainder = integer - (rounded << shift), half = 1n << (shift - 1n);
    if (remainder > half || (remainder === half && (sticky || (rounded & 1n)))) rounded++;
  }
  return Number(rounded) * 2 ** unit;
}

export function stringImports(cpu, errno) {
  // Read one mapped page at a time. A bounded, unterminated string can legally
  // end at the last byte of a page; strlen and wchar_t functions end at NUL.
  function* units(address, width, maximum = Infinity) {
    if (width === 4 && address % 4) throw Error('Unaligned wchar_t string');
    for (let count = 0; count < maximum;) {
      const at = address + count * width;
      if (at >= ADDRESS_SPACE) throw Error('Unterminated guest string');
      const size = Math.min(256, PAGE - (at % PAGE), (maximum - count) * width);
      const bytes = cpu.read(at, size);
      const words = width === 4 && new DataView(bytes.buffer, bytes.byteOffset, size);
      for (let offset = 0; offset < size; offset += width) {
        yield words ? words.getInt32(offset, true) : bytes[offset];
        count++;
      }
    }
  }
  function length(address, width, limit) {
    let n = 0;
    for (const c of units(address, width, limit)) { if (!c) break; n++; }
    return n;
  }
  function compare(a, width, limit, fold) {
    const right = units(a(1), width, limit);
    for (const c of units(a(0), width, limit)) {
      let d = right.next().value;
      const left = fold ? asciiLower(c) : c;
      if (fold) d = asciiLower(d);
      if (left !== d) return left < d ? -1 : 1;
      if (!c) break;
    }
    return 0;
  }
  function copy(dest, source, width, limit, append, checkedSize = Infinity) {
    const old = append ? length(dest, width) : 0;
    const n = length(source, width, limit);
    const write = append || limit === undefined ? n + 1 : limit;
    if (old + write > checkedSize) throw Error('Guest string copy exceeds destination size');
    const address = dest + old * width;
    if (n) move(cpu, address, source, n * width);
    if (write > n) fill(cpu, address + n * width, 0, (write - n) * width);
    return dest;
  }
  function findChar(address, value, width, last = false, limit) {
    let previous = 0, at = address;
    for (const c of units(address, width, limit)) {
      if (c === value) { previous = at; if (!last) return at; }
      if (!c && limit === undefined) break;
      at += width;
    }
    return previous;
  }
  function members(address, width) {
    const set = new Set();
    for (const c of units(address, width)) { if (!c) break; set.add(c); }
    return set;
  }
  function scan(address, width, set) {
    let n = 0;
    for (const c of units(address, width)) {
      if (!c || set.has(c)) return {n, found: c !== 0};
      n++;
    }
  }
  function substring(haystack, needle, width) {
    const pattern = [];
    for (const c of units(needle, width)) { if (!c) break; pattern.push(c); }
    if (!pattern.length) return haystack;
    // KMP also handles repeated prefixes without rescanning the guest memory.
    const prefix = new Uint32Array(pattern.length);
    for (let i = 1, j = 0; i < pattern.length; i++) {
      while (j && pattern[i] !== pattern[j]) j = prefix[j - 1];
      if (pattern[i] === pattern[j]) j++;
      prefix[i] = j;
    }
    let j = 0, at = haystack;
    for (const c of units(haystack, width)) {
      if (!c) break;
      while (j && c !== pattern[j]) j = prefix[j - 1];
      if (c === pattern[j] && ++j === pattern.length) return at - (j - 1) * width;
      at += width;
    }
    return 0;
  }
  function digit(c) {
    if (c >= 48 && c <= 57) return c - 48;
    c = asciiLower(c);
    return c >= 97 && c <= 122 ? c - 87 : -1;
  }
  function unsigned(a, width, bits) {
    const start = a(0), end = a(1);
    let base = a(2) | 0;
    if (base && (base < 2 || base > 36)) {
      write32(cpu, errno, 22);
      if (end) write32(cpu, end, start);
      return bits === 64 ? 0n : 0;
    }
    const stream = units(start, width);
    let at = start, c = stream.next().value;
    const advance = () => { at += width; c = stream.next().value; };
    while (c === 32 || (c >= 9 && c <= 13)) advance();
    const negative = c === 45;
    if (negative || c === 43) advance();
    // A prefix counts only when at least one valid hex digit follows it.
    let stop = start;
    if ((base === 0 || base === 16) && c === 48) {
      advance();
      stop = at;
      if (asciiLower(c) === 120) {
        advance();
        const following = digit(c);
        if (following < 0 || following > 15) {
          if (end) write32(cpu, end, stop);
          return bits === 64 ? 0n : 0;
        }
        base = 16;
      } else if (!base) base = 8;
    }
    base ||= 10;
    const radix = BigInt(base), limit = (1n << BigInt(bits)) - 1n;
    let value = 0n, overflow = false;
    for (;;) {
      const d = digit(c);
      if (d < 0 || d >= base) break;
      if (!overflow) {
        value = value * radix + BigInt(d);
        overflow = value > limit;
      }
      advance();
      stop = at;
    }
    if (end) write32(cpu, end, stop);
    if (overflow) { write32(cpu, errno, 34); value = limit; }
    else if (negative) value = BigInt.asUintN(bits, -value);
    return bits === 64 ? value : Number(value);
  }
  function multibyte(a) {
    const dest = a(0), capacity = dest ? a(2) : Infinity;
    if (!capacity) return 0;
    let n = 0;
    for (const c of units(a(1), 4)) {
      if (c < 0 || c >= 128) { write32(cpu, errno, 92); return 0xffffffff; }
      if (dest) cpu.write(dest + n, Uint8Array.of(c));
      if (!c) break;
      if (++n === capacity) break;
    }
    return n;
  }
  const latin = new TextDecoder('latin1'), realBits = new DataView(new ArrayBuffer(8));
  function real(source, end) {
    const text = latin.decode(readCStringBytes(cpu, source));
    const match = /^[\t-\r ]*([+-]?)(inf(?:inity)?|nan(?:\([a-z0-9_]*\))?|0x(?:[a-f\d]+(?:\.[a-f\d]*)?|\.[a-f\d]+)(?:p[+-]?\d+)?|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i.exec(text);
    let value = 0;
    if (match) {
      const token = match[2].toLowerCase(), hex = token.startsWith('0x');
      if (token.startsWith('inf')) value = Infinity;
      else if (token.startsWith('nan')) value = NaN;
      else {
        value = hex ? hexFloat(token) : Number(token);
        const significand = token.split(hex ? 'p' : 'e')[0];
        if (!Number.isFinite(value) || (value < 2 ** -1022 && /[1-9a-f]/.test(significand))) write32(cpu, errno, 34);
      }
      if (match[1] === '-') value = -value;
    }
    if (end) write32(cpu, end, source + (match?.[0].length ?? 0));
    realBits.setFloat64(0, value, true);
    return realBits.getBigUint64(0, true);
  }
  let cursor = 0;
  const funcs = {
    _strtoul: a => unsigned(a, 1, 32), _strtoull: a => unsigned(a, 1, 64),
    _strtod: a => real(a(0), a(1)), _atof: a => real(a(0), 0),
    _wcstoul: a => unsigned(a, 4, 32), _wcstombs: multibyte,
    _memchr: a => findChar(a(0), a(1) & 255, 1, false, a(2)),
    _memset_pattern16: a => {
      const n = a(2);
      if (!n) return;
      const pattern = cpu.read(a(1), 16), chunk = new Uint8Array(Math.min(n, 4096));
      for (let i = 0; i < chunk.length; i++) chunk[i] = pattern[i % 16];
      for (let i = 0; i < n; i += chunk.length) cpu.write(a(0) + i, chunk.subarray(0, n - i));
    },
    _strncmp: a => compare(a, 1, a(2), false),
    _strcasecmp: a => compare(a, 1, undefined, true),
    _strcoll: a => compare(a, 1, undefined, false),
    _strrchr: a => findChar(a(0), a(1) & 255, 1, true),
    _strcspn: a => scan(a(0), 1, members(a(1), 1)).n,
    ___strncpy_chk: a => copy(a(0), a(1), 1, a(2), false, a(3)),
    ___strcat_chk: a => copy(a(0), a(1), 1, undefined, true, a(2)),
    ___strncat_chk: a => copy(a(0), a(1), 1, a(2), true, a(3)),
    _strtok: a => {
      let p = a(0) || cursor;
      if (!p) return 0;
      const delimiters = members(a(1), 1);
      for (const c of units(p, 1)) {
        if (!c) { cursor = 0; return 0; }
        if (!delimiters.has(c)) break;
        p++;
      }
      const {n, found} = scan(p, 1, delimiters);
      cursor = found ? p + n + 1 : 0;
      if (found) cpu.write(p + n, Uint8Array.of(0));
      return p;
    },
    _wcscmp: a => compare(a, 4, undefined, false),
    ___maskrune: a => runeFlags(a(0) | 0) & a(1),
    ___toupper: a => asciiUpper(a(0)), ___tolower: a => asciiLower(a(0)),
  };
  for (const [prefix, width] of [['_str', 1], ['_wcs', 4]]) {
    funcs[prefix + 'len'] = a => length(a(0), width);
    funcs[prefix + 'cpy'] = a => copy(a(0), a(1), width, undefined, false);
    funcs[prefix + 'ncpy'] = a => copy(a(0), a(1), width, a(2), false);
    funcs[prefix + 'cat'] = a => copy(a(0), a(1), width, undefined, true);
    funcs[prefix + 'chr'] = a => findChar(a(0), width === 1 ? a(1) & 255 : a(1) | 0, width);
    funcs[prefix + 'str'] = a => substring(a(0), a(1), width);
    funcs[prefix + 'pbrk'] = a => {
      const {n, found} = scan(a(0), width, members(a(1), width));
      return found ? a(0) + n * width : 0;
    };
  }
  return funcs;
}
