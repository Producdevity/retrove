import { GuestLayout } from "./guest-layout";
const PAGE = 4096;
const HEAP_BASE: number = GuestLayout.HeapBase;
const HEAP_LIMIT: number = GuestLayout.HeapLimit;
const HEAP_ALIGNMENT = 16;
const STRING_CHUNK = 256;
const STRING_LIMIT = 0x100000;
const COPY_CHUNK = 65536;
const WORD_BYTES = 4;
const BYTE_BITS = 8;
const Byte = { Second: 1, Third: 2, Fourth: 3 } as const;
const READ_WRITE = 3;
const HEX = 16;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

export interface GuestMemory {
  read(address: number, size: number): Uint8Array;
  write(address: number, bytes: Uint8Array): void;
  /** CPUs with direct access to guest pages read words without a copy. */
  read32?(address: number): number;
}
export interface MappableMemory extends GuestMemory {
  map(address: number, size: number, permissions: number): void;
}
interface FreeBlock {
  address: number;
  size: number;
}

export function read32(cpu: GuestMemory, address: number): number {
  if (cpu.read32) return cpu.read32(address);
  const bytes = cpu.read(address, WORD_BYTES);
  return (
    ((bytes[0] ?? 0) |
      ((bytes[Byte.Second] ?? 0) << BYTE_BITS) |
      ((bytes[Byte.Third] ?? 0) << (BYTE_BITS * Byte.Third)) |
      ((bytes[Byte.Fourth] ?? 0) << (BYTE_BITS * Byte.Fourth))) >>>
    0
  );
}

export function write32(cpu: GuestMemory, address: number, value: number): void {
  const bytes = new Uint8Array(WORD_BYTES);
  new DataView(bytes.buffer).setUint32(0, value, true);
  cpu.write(address, bytes);
}

export function readCStringBytes(
  cpu: GuestMemory,
  address: number,
  limit = STRING_LIMIT,
): Uint8Array {
  const parts: Uint8Array[] = [];
  let length = 0;
  while (length < limit) {
    const position = address + length;
    const chunk = cpu.read(
      position,
      Math.min(STRING_CHUNK, PAGE - (position % PAGE), limit - length),
    );
    const end = chunk.indexOf(0);
    const part = end === -1 ? chunk : chunk.subarray(0, end);
    parts.push(part);
    length += part.length;
    if (end !== -1) {
      const output = new Uint8Array(length);
      let offset = 0;
      for (const piece of parts) {
        output.set(piece, offset);
        offset += piece.length;
      }
      return output;
    }
  }
  throw new Error(`Unterminated guest string at 0x${address.toString(HEX)}`);
}

export function readString(cpu: GuestMemory, address: number): string {
  return decoder.decode(readCStringBytes(cpu, address));
}

export function fill(cpu: GuestMemory, address: number, value: number, size: number): void {
  const block = new Uint8Array(Math.min(size, COPY_CHUNK)).fill(value);
  for (let offset = 0; offset < size; offset += block.length)
    cpu.write(address + offset, block.subarray(0, Math.min(size - offset, block.length)));
}

export function move(cpu: GuestMemory, target: number, source: number, size: number): void {
  const backward = target > source && target < source + size;
  for (let copied = 0; copied < size;) {
    const count = Math.min(size - copied, COPY_CHUNK);
    const offset = backward ? size - count - copied : copied;
    cpu.write(target + offset, cpu.read(source + offset, count));
    copied += count;
  }
}

export class Heap {
  readonly live = new Map<number, number>();
  #next = HEAP_BASE;
  #mapped = HEAP_BASE;
  readonly #free: FreeBlock[] = [];
  readonly #cpu: MappableMemory;

  constructor(cpu: MappableMemory) {
    this.#cpu = cpu;
  }

  get next(): number {
    return this.#next;
  }

  alloc(bytes: number, alignment = HEAP_ALIGNMENT): number {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > HEAP_LIMIT - HEAP_BASE) return 0;
    const size = Math.ceil(Math.max(1, bytes) / HEAP_ALIGNMENT) * HEAP_ALIGNMENT;
    const align = (pointer: number) => Math.ceil(pointer / alignment) * alignment;
    const index = this.#free.findIndex(
      (block) => align(block.address) + size <= block.address + block.size,
    );
    const block = this.#free[index];
    const address = block
      ? this.#takeFree(index, block, align(block.address), size)
      : this.#grow(align(this.#next), size);
    if (address) this.live.set(address, size);
    return address;
  }

  free(address: number): void {
    if (!address) return;
    const size = this.live.get(address);
    if (size === undefined) throw new Error(`Invalid guest free at 0x${address.toString(HEX)}`);
    this.live.delete(address);
    this.#addFree(address, size);
  }

  zero(bytes: number): number {
    const address = this.alloc(bytes);
    if (address && bytes) fill(this.#cpu, address, 0, bytes);
    return address;
  }

  string(value: string): number {
    const bytes = encoder.encode(`${value}\0`);
    const address = this.alloc(bytes.length);
    if (!address) throw new Error("Guest heap exhausted");
    this.#cpu.write(address, bytes);
    return address;
  }

  #takeFree(index: number, block: FreeBlock, address: number, size: number): number {
    const suffix = block.address + block.size - address - size;
    const pieces: FreeBlock[] = [];
    if (address > block.address)
      pieces.push({ address: block.address, size: address - block.address });
    if (suffix) pieces.push({ address: address + size, size: suffix });
    this.#free.splice(index, 1, ...pieces);
    return address;
  }

  #grow(address: number, size: number): number {
    if (address + size > HEAP_LIMIT) return 0;
    const end = Math.ceil((address + size) / PAGE) * PAGE;
    if (end > this.#mapped) this.#cpu.map(this.#mapped, end - this.#mapped, READ_WRITE);
    if (address > this.#next) this.#addFree(this.#next, address - this.#next);
    this.#mapped = end;
    this.#next = address + size;
    return address;
  }

  #addFree(address: number, size: number): void {
    let at = this.#free.findIndex((block) => block.address > address);
    if (at < 0) at = this.#free.length;
    this.#free.splice(at, 0, { address, size });
    for (let index = Math.max(0, at - 1); index < this.#free.length - 1 && index <= at;) {
      const left = this.#free[index],
        right = this.#free[index + 1];
      if (left && right && left.address + left.size === right.address) {
        left.size += right.size;
        this.#free.splice(index + 1, 1);
      } else index++;
    }
  }
}
