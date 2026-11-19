import { Lanes } from "./emit-constants";
import type { Instruction } from "./instruction";

const Ld2Registers = { pair: 2, spaced: 3, quad: 4 } as const;

/** Lanes of `count` consecutive D registers from `index`. */
export const doubleLanes = (index: number, count = 1): number[] =>
  Array.from({ length: Lanes.PerDouble * count }, (_, k) => Lanes.PerDouble * index + k);
/** Lanes of D register `index`, or of the Q register starting there. */
export const vectorLanes = (index: number, wide: boolean): number[] =>
  doubleLanes(index, wide ? Lanes.PerDouble : 1);
const remaining = (first: number, count: number) => Math.min(count, Lanes.DoubleRegisters - first);

/** Lanes (S0..S63 view of D0..D31) an instruction touches, in first-use order. */
export function lanesOf(i: Instruction): number[] {
  return vfpLanes(i) ?? simdLanes(i);
}

function vfpLanes(i: Instruction): number[] | undefined {
  const d = doubleLanes;
  switch (i.kind) {
    case "vmem":
      return i.double ? d(i.vd) : [i.vd];
    case "vmulti":
      return i.double
        ? d(i.first, remaining(i.first, i.count))
        : Array.from({ length: i.count }, (_, k) => i.first + k);
    case "varith":
      return i.double ? [...d(i.d), ...d(i.n), ...d(i.m)] : [i.d, i.n, i.m];
    case "vunary":
      return i.double ? [...d(i.d), ...d(i.m)] : [i.d, i.m];
    case "vmovimm":
      return i.double ? d(i.d) : [i.d];
    case "vcmp": {
      const m = i.m;
      if (i.double) return [...d(i.d), ...(m === undefined ? [] : d(m))];
      return [i.d, ...(m === undefined ? [] : [m])];
    }
    case "vcvt":
      if (!i.double) return [i.d, i.m];
      return i.toInt ? [i.d, ...d(i.m)] : [...d(i.d), i.m];
    case "vcvtfd":
      return i.toDouble ? [...d(i.d), i.m] : [i.d, ...d(i.m)];
    case "vmovcore":
      return [i.s];
    case "vmovpair":
      return d(i.dm);
    case "vmovscalar":
      return d(i.d);
    default:
      return undefined;
  }
}

function simdLanes(i: Instruction): number[] {
  const d = doubleLanes,
    q = vectorLanes;
  switch (i.kind) {
    case "vldst":
    case "vlane":
      return d(i.d, remaining(i.d, i.count));
    case "vld2":
      return d(i.d, remaining(i.d, Ld2Registers[i.form]));
    case "vlogic":
    case "vext":
    case "vfloat":
    case "vicompare":
    case "viorder":
    case "vshlreg":
    case "vstep":
    case "vfcmp":
    case "viarith":
      return [...q(i.d, i.q), ...q(i.n, i.q), ...q(i.m, i.q)];
    case "vfneg":
    case "vfcvt":
    case "vdup":
    case "vtrn":
    case "vzip":
    case "viunary":
    case "vmvn":
    case "vshli":
    case "vrev64":
    case "vestimate":
      return [...q(i.d, i.q), ...q(i.m, i.q)];
    case "vmulscalar":
      return [...q(i.d, i.q), ...q(i.n, i.q), ...d(i.m)];
    case "vpadd":
    case "vpminmax":
      return [...d(i.d), ...d(i.n), ...d(i.m)];
    case "vmovn":
    case "vqmovn":
      return [...d(i.d), ...q(i.m, true)];
    case "vdupcore":
    case "vmovi":
      return q(i.d, i.q);
    case "vmovl":
      return [...q(i.d, true), ...d(i.m)];
    default:
      return [];
  }
}
