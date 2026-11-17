/** Contiguous instruction field: `width` bits starting at bit `shift`. */
export interface BitField {
  readonly shift: number;
  readonly width: number;
}

export const WordBits = 32;
export const WordBytes = 4;
export const HalfBytes = 2;
export const ByteBits = 8;
export type InstructionSize = typeof HalfBytes | typeof WordBytes;
const WordAlignment = 3;
const SignShift = 31;

export const bit = (word: number, position: number): number => (word >>> position) & 1;
export const flag = (word: number, position: number): boolean => bit(word, position) === 1;
export const field = (word: number, at: BitField): number =>
  (word >>> at.shift) & ((1 << at.width) - 1);
export const ror = (value: number, amount: number): number =>
  amount === 0 ? value >>> 0 : ((value >>> amount) | (value << (WordBits - amount))) >>> 0;
export const signExtend = (value: number, width: number): number =>
  (value << (WordBits - width)) >> (WordBits - width);
export const signBit = (value: number): 0 | 1 => (value >>> SignShift === 1 ? 1 : 0);
export const align4 = (value: number): number => value & ~WordAlignment;

/** Registers whose bits are set in `list`, scanning `count` bits from bit 0. */
export function registerList(list: number, count: number): number[] {
  const registers: number[] = [];
  for (let register = 0; register < count; register++)
    if (bit(list, register)) registers.push(register);
  return registers;
}
