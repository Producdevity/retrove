/** Where a new guest thread runs. */
export const Placement = {
  /** On the main thread's cooperative scheduler. */
  Cooperative: 0,
  /** On any execution worker. */
  Worker: 1,
  /** On the execution worker that owns the WebGL context, so its GL calls need no round trip. */
  Graphics: 2,
} as const;
export type Placement = (typeof Placement)[keyof typeof Placement];

export interface ThreadCandidate {
  readonly id: number;
  /** Start routine. */
  readonly pc: number;
  readonly args: readonly number[];
}

/**
 * Picks a guest thread by its start routine and, for engines that start every thread through one
 * routine, by the code its argument leads to.
 */
export interface ThreadRule {
  /** Symbol of the start routine. */
  readonly entry: string;
  /**
   * Byte offsets to load through, starting from the first argument; the last load must yield the
   * address of `symbol` (for example runnable, then vtable, then a virtual method slot).
   */
  readonly target?: { readonly path: readonly number[]; readonly symbol: string };
  readonly placement: Placement;
}

export interface PlacementImage {
  symbolAt(address: number): { readonly name: string; readonly offset: number } | undefined;
}

const THUMB_BIT = 1;

function at(image: PlacementImage, address: number, symbol: string): boolean {
  const found = image.symbolAt((address & ~THUMB_BIT) >>> 0);
  return found?.name === symbol && found.offset === 0;
}

/** The placement for a candidate thread from the first rule that matches it. */
export function threadPlacement(
  rules: readonly ThreadRule[],
  image: PlacementImage,
  read32: (address: number) => number,
): (thread: ThreadCandidate) => Placement {
  const follow = (start: number, path: readonly number[]): number | undefined => {
    let value = start;
    try {
      for (const offset of path) value = read32((value + offset) >>> 0);
    } catch {
      return undefined;
    }
    return value;
  };
  return (thread) => {
    for (const rule of rules) {
      if (!at(image, thread.pc, rule.entry)) continue;
      if (!rule.target) return rule.placement;
      const target = follow(thread.args[0] ?? 0, rule.target.path);
      if (target !== undefined && at(image, target, rule.target.symbol)) return rule.placement;
    }
    return Placement.Cooperative;
  };
}
