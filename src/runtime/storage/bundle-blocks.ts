/** 64 KiB: games read packages in small scattered pieces; a block bounds what one miss reads. */
const BLOCK_BYTES = 65_536;
/** 32 MiB of blocks shared by every bundle file. */
const BUDGET_BYTES = 33_554_432;
/** One Blob read covers up to 16 adjacent missing blocks (1 MiB). */
const SPAN_BLOCKS = 16;
/** Streaming reads this long skip the cache so they do not evict the scattered blocks. */
const DIRECT_BYTES = 262_144;

/** A read-only bundle asset; reads are Blob slices, which cost a disk round trip and a fresh buffer each. */
export interface BlockSource {
  readonly size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

/**
 * Aligned blocks of read-only bundle files, keyed by bundle path so they outlive a close and
 * reopen, evicted least recently used first. Reads that repeat or interleave across files are
 * served without another Blob read.
 */
export class BundleBlocks {
  readonly #blocks = new Map<string, Uint8Array>();
  #bytes = 0;
  constructor(
    private readonly track: (delta: number) => void,
    readonly budget = BUDGET_BYTES,
    readonly blockBytes = BLOCK_BYTES,
  ) {}
  get bytes(): number {
    return this.#bytes;
  }
  /** Copies `count` bytes from `offset` through `write`; returns how many the source holds. */
  async read(
    path: string,
    source: BlockSource,
    offset: number,
    count: number,
    write: (done: number, bytes: Uint8Array) => void,
  ): Promise<number> {
    const end = Math.min(source.size, offset + count);
    for (let at = offset; at < end;) {
      const index = Math.floor(at / this.blockBytes),
        cached = this.#take(path, index);
      if (!cached && end - at >= DIRECT_BYTES) {
        const stop = Math.min(end, at + SPAN_BLOCKS * this.blockBytes);
        write(at - offset, new Uint8Array(await source.slice(at, stop).arrayBuffer()));
        at = stop;
        continue;
      }
      const block = cached ?? (await this.#load(path, source, index, end));
      const from = at - index * this.blockBytes,
        take = Math.min(end - at, block.length - from);
      write(at - offset, block.subarray(from, from + take));
      at += take;
    }
    return Math.max(0, end - offset);
  }
  #key(path: string, index: number): string {
    return `${index}:${path}`;
  }
  #take(path: string, index: number): Uint8Array | undefined {
    const key = this.#key(path, index),
      block = this.#blocks.get(key);
    if (!block) return undefined;
    this.#blocks.delete(key);
    this.#blocks.set(key, block);
    return block;
  }
  async #load(path: string, source: BlockSource, first: number, end: number): Promise<Uint8Array> {
    const lastNeeded = Math.floor((end - 1) / this.blockBytes);
    let last = first;
    while (
      last < lastNeeded &&
      last - first + 1 < SPAN_BLOCKS &&
      !this.#blocks.has(this.#key(path, last + 1))
    )
      last++;
    const start = first * this.blockBytes,
      bytes = new Uint8Array(
        await source
          .slice(start, Math.min(source.size, (last + 1) * this.blockBytes))
          .arrayBuffer(),
      );
    let block: Uint8Array | undefined;
    for (let index = first; index <= last; index++) {
      const from = (index - first) * this.blockBytes;
      if (from >= bytes.length) break;
      const piece = bytes.slice(from, from + this.blockBytes);
      this.#store(this.#key(path, index), piece);
      block ??= piece;
    }
    return block ?? new Uint8Array(0);
  }
  #store(key: string, block: Uint8Array): void {
    const previous = this.#blocks.get(key);
    if (previous) this.#forget(key, previous);
    this.#blocks.set(key, block);
    this.#bytes += block.length;
    this.track(block.length);
    for (const [oldest, evicted] of this.#blocks) {
      if (this.#bytes <= this.budget || oldest === key) break;
      this.#forget(oldest, evicted);
    }
  }
  #forget(key: string, block: Uint8Array): void {
    this.#blocks.delete(key);
    this.#bytes -= block.length;
    this.track(-block.length);
  }
}
