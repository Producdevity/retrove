const WORD_BYTES = 4;
/** Far enough below zero that a slice's own decrement racing with the store still leaves it negative. */
const PREEMPTED = -0x4000_0000;

/**
 * Ends another thread's translated slice early by writing its state block's budget word: its code
 * leaves at the next loop head or function entry, and its run loop answers whoever asked. A store
 * that loses a race with the slice's own budget update only delays the answer to the slice's end.
 */
export class Preemption {
  readonly #words: Int32Array;
  readonly #index: number;
  /** `budget` is the host address of the slice's budget word in `buffer`. */
  constructor(buffer: ArrayBufferLike, budget: number) {
    this.#words = new Int32Array(buffer);
    this.#index = budget / WORD_BYTES;
  }
  trigger(): void {
    Atomics.store(this.#words, this.#index, PREEMPTED);
  }
}
