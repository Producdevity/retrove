import type { TranslatedTier } from "../translation/tier";

const PAGE_BYTES = 4096;
const ADDRESS_SPACE = 0x1_0000_0000;
const EXECUTE = 4;
const ALL_PERMISSIONS = 7;
const WORD_BYTES = 4;

/** Validates a guest address and the range after it; returns the address. */
export function guestRange(address: number, size: number, aligned = false): number {
  if (!Number.isInteger(address) || address < 0 || address >= ADDRESS_SPACE)
    throw new RangeError("address must be an unsigned 32-bit integer");
  if (!Number.isSafeInteger(size) || size < 0 || address + size > ADDRESS_SPACE)
    throw new RangeError("Invalid guest address range");
  if (aligned && (!size || address % PAGE_BYTES || size % PAGE_BYTES))
    throw new RangeError("Guest mappings require nonempty 4 KiB-aligned ranges");
  return address;
}

/**
 * Guest mappings straight in the translated tier's arena. Writes to pages that may hold code drop
 * their translations; data pages skip that check.
 */
export class GuestMappings {
  mappedBytes = 0;
  mappedPeak = 0;
  readonly #dataPages = new Uint8Array(ADDRESS_SPACE / PAGE_BYTES);
  constructor(private readonly tier: TranslatedTier) {}
  /** Wasm memory that holds data: reserved arena pages count only once mapped. */
  get committedBytes(): number {
    const pages = this.tier.pages;
    return pages.bytes.byteLength - (pages.region.bytes - this.mappedPeak);
  }
  #mark(address: number, size: number, permissions: number): void {
    this.#dataPages.fill(
      permissions & EXECUTE ? 0 : 1,
      address / PAGE_BYTES,
      Math.ceil((address + size) / PAGE_BYTES),
    );
  }
  #dataOnly(address: number, size: number): boolean {
    const pages = this.#dataPages.subarray(
      Math.floor(address / PAGE_BYTES),
      Math.ceil((address + size) / PAGE_BYTES),
    );
    return size > 0 && pages.every((flag) => flag === 1);
  }
  map(address: number, size: number, permissions = ALL_PERMISSIONS): void {
    guestRange(address, size, true);
    this.tier.pages.map(address, size);
    this.#mark(address, size, permissions);
    this.mappedBytes += size;
    this.mappedPeak = Math.max(this.mappedPeak, this.mappedBytes);
  }
  unmap(address: number, size: number): void {
    guestRange(address, size, true);
    this.tier.invalidate(address, size);
    this.tier.pages.unmap(address, size);
    this.#mark(address, size, EXECUTE);
    this.mappedBytes -= size;
  }
  protect(address: number, size: number, permissions: number): void {
    guestRange(address, size, true);
    this.#mark(address, size, permissions);
  }
  write(address: number, bytes: Uint8Array): void {
    guestRange(address, bytes.length);
    if (!this.tier.pages.write(address, bytes))
      throw new Error("Guest memory write failed: Invalid memory write (unmapped)");
    if (!this.#dataOnly(address, bytes.length)) this.tier.invalidate(address, bytes.length);
  }
  read(address: number, length: number): Uint8Array {
    guestRange(address, length);
    const bytes = new Uint8Array(length);
    if (!this.tier.pages.read(address, bytes))
      throw new Error("Guest memory read failed: Invalid memory read (unmapped)");
    return bytes;
  }
  read32(address: number): number {
    const word = this.tier.pages.word(guestRange(address, WORD_BYTES));
    if (word === undefined)
      throw new Error("Guest memory read failed: Invalid memory read (unmapped)");
    return word >>> 0;
  }
}
