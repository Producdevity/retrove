export const PointerPhase = {
  Down: "pointerdown",
  Move: "pointermove",
  Up: "pointerup",
  Cancel: "pointercancel",
} as const;
export type PointerPhase = (typeof PointerPhase)[keyof typeof PointerPhase];
export interface PointerSample {
  readonly id: number;
  readonly type: PointerPhase;
  readonly point: readonly [number, number];
  readonly time: number;
}
export const TouchPhase = { Began: 0, Moved: 1, Stationary: 2, Ended: 3, Cancelled: 4 };
export class PointerQueue {
  readonly #pending: PointerSample[] = [];
  #coalesced = 0;
  get coalesced(): number {
    return this.#coalesced;
  }
  get length(): number {
    return this.#pending.length;
  }
  push(sample: PointerSample): void {
    const last = this.#pending.at(-1);
    if (
      sample.type === PointerPhase.Move &&
      last?.type === PointerPhase.Move &&
      sample.id === last.id
    ) {
      this.#pending[this.#pending.length - 1] = sample;
      this.#coalesced++;
    } else this.#pending.push(sample);
  }
  clear(): number {
    const count = this.#pending.length;
    this.#pending.length = 0;
    return count;
  }
  takeTurn(): PointerSample[] {
    const pointers = new Set<number>();
    let count = 0;
    for (const sample of this.#pending) {
      if (pointers.has(sample.id)) break;
      pointers.add(sample.id);
      count++;
    }
    return this.#pending.splice(0, count);
  }
}
