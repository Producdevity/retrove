import type { HostResult } from "../../objc/host";
import { MERGE_FACTOR } from "./constants";

function valueAt(list: readonly number[], index: number): number {
  const value = list[index];
  if (value === undefined) throw new Error("Invalid sort element");
  return value;
}
export function comparisonOrder(value: HostResult): number {
  return typeof value === "number" ? value | 0 : 0;
}
/** Stable bottom-up merge sort whose comparison is an asynchronous guest message. */
export async function mergeSorted(
  list: readonly number[],
  compare: (left: number, right: number) => Promise<number>,
): Promise<number[]> {
  const length = list.length;
  let result = [...list];
  let next: number[] = Array.from({ length }, () => 0);
  for (let width = 1; width < length; width *= MERGE_FACTOR) {
    for (let start = 0; start < length; start += MERGE_FACTOR * width) {
      const middle = Math.min(start + width, length);
      const end = Math.min(start + MERGE_FACTOR * width, length);
      let left = start;
      let right = middle;
      for (let out = start; out < end; out++) {
        const takeLeft =
          left < middle &&
          (right >= end || (await compare(valueAt(result, left), valueAt(result, right))) <= 0);
        next[out] = takeLeft ? valueAt(result, left++) : valueAt(result, right++);
      }
    }
    [next, result] = [result, next];
  }
  return result;
}
