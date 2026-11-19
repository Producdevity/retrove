/** The view state that decides where a view lands on screen and how its ancestors clip it. */
export interface PlacedView {
  readonly frame: readonly number[];
  readonly bounds: readonly number[];
  readonly transform?: readonly number[] | undefined;
  readonly anchorPoint?: readonly number[] | undefined;
  readonly clipsToBounds?: unknown;
  readonly masksToBounds?: unknown;
  readonly parent?: number | undefined;
}

const NONE: readonly number[] = [];

/**
 * Per-view placement results reused while nothing they depend on changed: the geometry of the view
 * and every ancestor, plus `screen` (display bounds, aspect and orientation). The compositor runs
 * every event-loop turn; recomputing points and clip polygons through the whole ancestor chain
 * for every view allocated megabytes per second that WebKit kept as heap.
 */
export class PlacementCache<Placement> {
  readonly #keys = new Map<number, number[]>();
  readonly #placements = new Map<number, Placement>();
  /** The cached placement, or a fresh one from `compute` when an input changed. */
  get(
    view: number,
    read: (view: number) => PlacedView,
    screen: readonly number[],
    compute: () => Placement,
  ): Placement {
    const changed = this.#changed(view, read, screen),
      cached = this.#placements.get(view);
    if (cached !== undefined && !changed) return cached;
    const placement = compute();
    this.#placements.set(view, placement);
    return placement;
  }
  forget(view: number): void {
    this.#keys.delete(view);
    this.#placements.delete(view);
  }
  clear(): void {
    this.#keys.clear();
    this.#placements.clear();
  }
  #changed(view: number, read: (view: number) => PlacedView, screen: readonly number[]): boolean {
    const key = this.#keys.get(view) ?? [];
    let index = 0,
      changed = false;
    const put = (value: number): void => {
      if (key[index] !== value) {
        key[index] = value;
        changed = true;
      }
      index++;
    };
    const putAll = (values: readonly number[]): void => {
      for (let at = 0; at < values.length; at++) put(values[at] ?? 0);
    };
    putAll(screen);
    for (let at: number | undefined = view; at; at = read(at).parent) {
      const state = read(at);
      put(at);
      putAll(state.frame);
      putAll(state.bounds);
      putAll(state.transform ?? NONE);
      putAll(state.anchorPoint ?? NONE);
      put(state.clipsToBounds ? 1 : 0);
      put(state.masksToBounds ? 1 : 0);
    }
    if (key.length !== index) {
      key.length = index;
      changed = true;
    }
    this.#keys.set(view, key);
    return changed;
  }
}
