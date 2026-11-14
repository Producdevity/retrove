import { floatFromBits } from "../../ios/abi/scalars";
import type { GuestArguments } from "../../ios/objc/host";
const Field = { A: 0, B: 1, C: 2, D: 3, TX: 4, TY: 5 } as const;
export type AffineTransform = readonly [number, number, number, number, number, number];
export function affineArguments(args: GuestArguments, first = 0): AffineTransform {
  const read = (field: number) => floatFromBits(args(first + field));
  return [
    read(Field.A),
    read(Field.B),
    read(Field.C),
    read(Field.D),
    read(Field.TX),
    read(Field.TY),
  ];
}
export function affineImports(): Record<string, (args: GuestArguments) => number> {
  return {
    _CGAffineTransformIsIdentity: (args) => {
      const [a, b, c, d, tx, ty] = affineArguments(args);
      return Number(a === 1 && b === 0 && c === 0 && d === 1 && tx === 0 && ty === 0);
    },
  };
}
