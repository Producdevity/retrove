import { guestRange } from "../own/guest-mappings";
import { COPY_CHUNK, type UnicornParts } from "./setup";

const PAGE = 4096;
const PAGE_SHIFT = 12;
const PAGE_OFFSET = PAGE - 1;
/** Pages in the 32-bit guest address space. */
const PAGE_COUNT = 1_048_576;
const WORD_BYTES = 4;
const LAST_WORD = PAGE - WORD_BYTES;
const BYTE_BITS = 8;
const Byte = { Second: 1, Third: 2, Fourth: 3 } as const;
const EXECUTE = 4;
const ALL_PERMISSIONS = 7;
const MAP_POINTER_ARGUMENTS = ["pointer", "number", "number", "number", "pointer"] as const;

/** Guest memory of a Unicorn CPU, shared with the translated tier's arena when it is enabled. */
export class UnicornMemory {
  #mappedBytes = 0;
  #mappedPeak = 0;
  readonly #parts: UnicornParts;
  // Pages without execute permission hold no Unicorn blocks or translations, so host writes skip invalidation.
  readonly #dataPages: Uint8Array | undefined;
  constructor(parts: UnicornParts) {
    this.#parts = parts;
    this.#dataPages = parts.translation ? new Uint8Array(PAGE_COUNT) : undefined;
  }
  get mappedBytes(): number {
    return this.#mappedBytes;
  }
  get mappedPeak(): number {
    return this.#mappedPeak;
  }
  #mark(address: number, size: number, permissions: number): void {
    this.#dataPages?.fill(
      permissions & EXECUTE ? 0 : 1,
      address >>> PAGE_SHIFT,
      Math.ceil((address + size) / PAGE),
    );
  }
  #dataOnly(address: number, size: number): boolean {
    return (
      !!this.#dataPages &&
      size > 0 &&
      this.#dataPages
        .subarray(address >>> PAGE_SHIFT, Math.ceil((address + size) / PAGE))
        .every((flag) => flag === 1)
    );
  }
  map(address: number, size: number, permissions = ALL_PERMISSIONS): void {
    guestRange(address, size, true);
    const { uc, handle, engine, translation } = this.#parts;
    if (translation) {
      const pages = translation.tier.pages;
      const status = uc.ccall("uc_mem_map_ptr", "number", MAP_POINTER_ARGUMENTS, [
        handle,
        BigInt(address),
        BigInt(size),
        permissions,
        pages.map(address, size),
      ]);
      if (status !== uc.ERR_OK) {
        pages.unmap(address, size);
        throw new Error(`Guest mapping failed: ${uc.strerror(status)}`);
      }
    } else engine.mem_map(address, size, permissions);
    this.#mark(address, size, permissions);
    this.#mappedBytes += size;
    this.#mappedPeak = Math.max(this.#mappedPeak, this.#mappedBytes);
  }
  unmap(address: number, size: number): void {
    guestRange(address, size, true);
    const tier = this.#parts.translation?.tier;
    this.#parts.engine.mem_unmap(address, size);
    tier?.invalidate(address, size);
    tier?.pages.unmap(address, size);
    this.#mark(address, size, EXECUTE);
    this.#mappedBytes -= size;
  }
  protect(address: number, size: number, permissions: number): void {
    guestRange(address, size, true);
    this.#parts.engine.mem_protect(address, size, permissions);
    this.#mark(address, size, permissions);
  }
  write(address: number, data: Uint8Array | ArrayLike<number>): void {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    guestRange(address, bytes.length);
    const { uc, handle, transfer, translation } = this.#parts;
    const tier = translation?.tier;
    if (tier && this.#dataOnly(address, bytes.length) && tier.pages.write(address, bytes)) return;
    for (let i = 0; i < bytes.length; i += COPY_CHUNK) {
      const chunk = bytes.subarray(i, i + COPY_CHUNK);
      uc.HEAPU8.set(chunk, transfer);
      const code = uc._uc_mem_write(handle, BigInt(address + i), transfer, BigInt(chunk.length));
      if (code !== uc.ERR_OK) throw new Error(`Guest memory write failed: ${uc.strerror(code)}`);
      const invalidation = uc._retrove_tci_invalidate(handle, address + i, chunk.length);
      if (invalidation !== uc.ERR_OK)
        throw new Error(`Guest code invalidation failed: ${uc.strerror(invalidation)}`);
      tier?.invalidate(address + i, chunk.length);
    }
  }
  read(address: number, length: number): Uint8Array {
    guestRange(address, length);
    const { uc, handle, transfer, translation } = this.#parts;
    const bytes = new Uint8Array(length);
    if (translation?.tier.pages.read(address, bytes)) return bytes;
    for (let i = 0; i < length; i += COPY_CHUNK) {
      const count = Math.min(COPY_CHUNK, length - i);
      const code = uc._uc_mem_read(handle, BigInt(address + i), transfer, BigInt(count));
      if (code !== uc.ERR_OK) throw new Error(`Guest memory read failed: ${uc.strerror(code)}`);
      bytes.set(uc.HEAPU8.subarray(transfer, transfer + count), i);
    }
    return bytes;
  }
  read32(address: number): number {
    const pages = this.#parts.translation?.tier.pages;
    const host = pages && (address & PAGE_OFFSET) <= LAST_WORD ? pages.host(address) : -1;
    if (pages && host >= 0) return pages.view.getUint32(host, true);
    const b = this.read(address, WORD_BYTES);
    return (
      ((b[0] ?? 0) |
        ((b[Byte.Second] ?? 0) << BYTE_BITS) |
        ((b[Byte.Third] ?? 0) << (BYTE_BITS * Byte.Third)) |
        ((b[Byte.Fourth] ?? 0) << (BYTE_BITS * Byte.Fourth))) >>>
      0
    );
  }
}
