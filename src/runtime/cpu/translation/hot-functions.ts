/**
 * Interpreter entries before a function is translated. Code that runs once, such as level
 * loading, stays interpreted: translating all of it cost BioShock ~250 MB of Wasm, which
 * iOS answers by closing the page.
 */
export const HOT_ENTRIES = 8;

/** Counts interpreter entries per function until one becomes hot enough to translate. */
export class HotFunctions {
  readonly #entries = new Map<number, number>();
  constructor(private readonly threshold = HOT_ENTRIES) {}
  /** Records an entry; true once the function reached the threshold. */
  enter(start: number): boolean {
    const count = (this.#entries.get(start) ?? 0) + 1;
    if (count < this.threshold) {
      this.#entries.set(start, count);
      return false;
    }
    this.#entries.delete(start);
    return true;
  }
}
