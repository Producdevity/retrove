const PAGE = 4096;
const BASE = 0x20000000;
const LIMIT = 0x38000000;
const decoder = new TextDecoder();

export function read32(cpu, address) {
  const b = cpu.read(address, 4);
  return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
}

export function write32(cpu, address, value) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value, true);
  cpu.write(address, b);
}

export function readCStringBytes(cpu, address, limit = 1 << 20) {
  const parts = [];
  let length = 0;
  while (length < limit) {
    const pos = address + length;
    const chunk = cpu.read(pos, Math.min(256, PAGE - (pos % PAGE), limit - length));
    const end = chunk.indexOf(0);
    parts.push(end === -1 ? chunk : chunk.subarray(0, end));
    length += parts.at(-1).length;
    if (end !== -1) {
      const out = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) { out.set(part, offset); offset += part.length; }
      return out;
    }
  }
  throw new Error('Unterminated guest string at 0x' + address.toString(16));
}
export function readString(cpu, address) { return decoder.decode(readCStringBytes(cpu, address)); }

export class Heap {
  constructor(cpu) {
    this.cpu = cpu;
    this.next = BASE;
    this.mapped = BASE;
    this.live = new Map();
    this.freeBlocks = [];
  }

  alloc(bytes, alignment = 16) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > LIMIT - BASE) return 0;
    const size = Math.ceil(Math.max(1, bytes) / 16) * 16;
    const align = p => Math.ceil(p / alignment) * alignment;
    const index = this.freeBlocks.findIndex(b => align(b.address) + size <= b.address + b.size);
    let address;
    if (index !== -1) {
      const block = this.freeBlocks[index];
      address = align(block.address);
      const suffix = block.address + block.size - address - size;
      const pieces = [];
      if (address > block.address) pieces.push({address: block.address, size: address - block.address});
      if (suffix) pieces.push({address: address + size, size: suffix});
      this.freeBlocks.splice(index, 1, ...pieces);
    } else {
      address = align(this.next);
      if (address + size > LIMIT) return 0;
      const end = Math.ceil((address + size) / PAGE) * PAGE;
      if (end > this.mapped) this.cpu.map(this.mapped, end - this.mapped, 3);
      if (address > this.next) this.addFree(this.next, address - this.next);
      this.mapped = end;
      this.next = address + size;
    }
    this.live.set(address, size);
    return address;
  }

  free(address) {
    if (!address) return;
    const size = this.live.get(address);
    if (size === undefined) throw new Error('Invalid guest free at 0x' + address.toString(16));
    this.live.delete(address);
    this.addFree(address, size);
  }

  addFree(address, size) {
    let at = this.freeBlocks.findIndex(b => b.address > address);
    if (at < 0) at = this.freeBlocks.length;
    this.freeBlocks.splice(at, 0, {address, size});
    for (let i = Math.max(0, at - 1); i < this.freeBlocks.length - 1 && i <= at; ) {
      const a = this.freeBlocks[i], b = this.freeBlocks[i + 1];
      if (a.address + a.size === b.address) {
        a.size += b.size;
        this.freeBlocks.splice(i + 1, 1);
      } else i++;
    }
  }

  zero(bytes) {
    const address = this.alloc(bytes);
    if (address && bytes) fill(this.cpu, address, 0, bytes);
    return address;
  }
  string(s) {
    const b = new TextEncoder().encode(s + '\0');
    const address = this.alloc(b.length);
    if (!address) throw new Error('Guest heap exhausted');
    this.cpu.write(address, b);
    return address;
  }
}

export function fill(cpu, address, value, size) {
  const block = new Uint8Array(Math.min(size, 65536)).fill(value);
  for (let offset = 0; offset < size; offset += block.length)
    cpu.write(address + offset, block.subarray(0, Math.min(size - offset, block.length)));
}

export function move(cpu, dst, src, size) {
  const backward = dst > src && dst < src + size;
  for (let copied = 0; copied < size;) {
    const count = Math.min(size - copied, 65536);
    const off = backward ? size - count - copied : copied;
    cpu.write(dst + off, cpu.read(src + off, count));
    copied += count;
  }
}
