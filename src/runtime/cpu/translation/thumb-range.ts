import { HalfBytes, WordBytes, type InstructionSize } from "./bits";
import { Condition, nop, unsupported, type Instruction } from "./instruction";
import { decodeThumb16 } from "./thumb-16";
import { decodeThumb32 } from "./thumb-32";

/** Decoded Thumb instruction; `address` is the halfword address without the Thumb bit. */
export interface ThumbDecoded {
  readonly address: number;
  readonly size: InstructionSize;
  readonly instruction: Instruction;
  readonly itStart?: number;
}

const Wide = { Shift: 11, Minimum: 0b11101 } as const;
const It = {
  Mask: 0xff00,
  Opcode: 0xbf00,
  State: 0xff,
  Pending: 0xf,
  ConditionShift: 4,
  Last: 7,
  Base: 0xe0,
  Advance: 0x1f,
} as const;

/**
 * Decodes a Thumb range sequentially so IT blocks assign conditions to the instructions they cover. Control flow
 * never enters an IT block, so IT state restarts at every address in `roots`; this keeps literal data that happens
 * to look like an IT instruction from conditionalizing the code after it.
 */
export function decodeThumbRange(
  start: number,
  end: number,
  half: (address: number) => number | undefined,
  roots: ReadonlySet<number> = new Set(),
): ThumbDecoded[] {
  const out: ThumbDecoded[] = [];
  let it = 0,
    itStart = 0;
  for (let address = start; address < end;) {
    if (roots.has(address)) it = 0;
    const h1 = half(address);
    if (h1 === undefined) {
      out.push({ address, size: HalfBytes, instruction: unsupported(Condition.Always) });
      address += HalfBytes;
      it = 0;
      continue;
    }
    const wide = h1 >>> Wide.Shift >= Wide.Minimum;
    const inIt = (it & It.Pending) !== 0;
    const cond = inIt ? it >>> It.ConditionShift : Condition.Always;
    let instruction: Instruction;
    let size: InstructionSize = HalfBytes;
    if (wide) {
      const h2 = half(address + HalfBytes);
      size = WordBytes;
      instruction = h2 === undefined ? unsupported(cond) : decodeThumb32(h1, h2, address, cond);
    } else instruction = decodeThumb16(h1, address, cond, inIt);
    if (!inIt && (h1 & It.Mask) === It.Opcode && h1 & It.Pending) {
      it = h1 & It.State;
      itStart = address;
      out.push({ address, size, instruction: nop() });
      address += size;
      continue;
    }
    out.push(inIt ? { address, size, instruction, itStart } : { address, size, instruction });
    if (inIt) it = (it & It.Last) === 0 ? 0 : (it & It.Base) | ((it << 1) & It.Advance);
    address += size;
  }
  return out;
}
