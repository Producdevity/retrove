import type { FunctionRange } from "./translate";

const WORD_BYTES = 4;
const Bl = {
  Mask: 0x0f000000,
  Opcode: 0x0b000000,
  ConditionShift: 28,
  Unconditional: 15,
  OffsetShift: 8,
  TargetShift: 6,
  PipelineBytes: 8,
} as const;
/** Direct BL targets of an ARM function, translated in the same batch so calls stay inside Wasm. */
export function calleeStarts(
  range: FunctionRange,
  readWord: (address: number) => number | undefined,
): number[] {
  const targets: number[] = [];
  for (let address = range.start; address < range.end; address += WORD_BYTES) {
    const word = readWord(address);
    if (
      word === undefined ||
      (word & Bl.Mask) !== Bl.Opcode ||
      word >>> Bl.ConditionShift === Bl.Unconditional
    )
      continue;
    targets.push((address + Bl.PipelineBytes + ((word << Bl.OffsetShift) >> Bl.TargetShift)) >>> 0);
  }
  return targets;
}
