import type { GuestArguments } from "../../ios/objc/host";
import { floatFromBits } from "../../ios/abi/scalars";

const Position = {
  First: 0,
  Second: 1,
  Third: 2,
  Fourth: 3,
  Fifth: 4,
  Sixth: 5,
  Seventh: 6,
  Eighth: 7,
  Ninth: 8,
} as const;
export type Words2 = [number, number];
export type Words3 = [number, number, number];
export type Words4 = [number, number, number, number];
export type Words5 = [number, number, number, number, number];
export type Words6 = [number, number, number, number, number, number];
export type Words7 = [number, number, number, number, number, number, number];
export type Words8 = [number, number, number, number, number, number, number, number];
export type Words9 = [number, number, number, number, number, number, number, number, number];

export const words2 = (a: GuestArguments): Words2 => [a(Position.First), a(Position.Second)];
export const words3 = (a: GuestArguments): Words3 => [...words2(a), a(Position.Third)];
export const words4 = (a: GuestArguments): Words4 => [...words3(a), a(Position.Fourth)];
export const words5 = (a: GuestArguments): Words5 => [...words4(a), a(Position.Fifth)];
export const words6 = (a: GuestArguments): Words6 => [...words5(a), a(Position.Sixth)];
export const words7 = (a: GuestArguments): Words7 => [...words6(a), a(Position.Seventh)];
export const words8 = (a: GuestArguments): Words8 => [...words7(a), a(Position.Eighth)];
export const words9 = (a: GuestArguments): Words9 => [...words8(a), a(Position.Ninth)];

/** A guest word as the signed 32-bit integer C passes for a GLint or GLsizei. */
export const signed = (value: number): number => value | 0;
export const float = floatFromBits;
