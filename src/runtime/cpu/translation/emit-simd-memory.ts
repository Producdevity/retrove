import { guest, hostAt, reg } from "./emit-access";
import { Lanes, Word } from "./emit-constants";
import { getLane, setLane } from "./emit-float";
import { emitUnsupported } from "./emit-state";
import { transferLanes } from "./emit-vfp";
import type { Emitter } from "./emitter";
import { Register, type InstructionOf } from "./instruction";
import { doubleLanes } from "./lanes";
import { Op } from "./wasm-opcodes";

const DoubleBytes = 8;
const SpacedStride = 2;
const QuadSecond = 2;

/** Post-indexing: Rm = SP adds the transfer size, Rm = PC leaves Rn alone, otherwise Rn += Rm. */
export function postIndex(
  e: Emitter,
  pc: number,
  base: number,
  rn: number,
  rm: number,
  bytes: number,
): void {
  const { c } = e;
  if (rm === Register.SP) c.get(base).i32(bytes).op(Op.I32Add).set(e.register(rn));
  else if (rm !== Register.PC) {
    c.get(base);
    reg(e, rm, pc);
    c.op(Op.I32Add).set(e.register(rn));
  }
}

/** VLD1/VST1 (multiple registers). */
export function emitElements(e: Emitter, pc: number, i: InstructionOf<"vldst">): void {
  const { c } = e,
    [base, address] = e.t;
  if (i.rn === Register.PC || i.d + i.count > Lanes.DoubleRegisters) return emitUnsupported(e, pc);
  reg(e, i.rn, pc);
  c.tee(base).set(address);
  transferLanes(e, i.load, address, doubleLanes(i.d, i.count));
  postIndex(e, pc, base, i.rn, i.rm, DoubleBytes * i.count);
}

/** VLD2/VST2 of 32-bit elements: even elements go to the first register list, odd ones to the second. */
export function emitPairs(e: Emitter, pc: number, i: InstructionOf<"vld2">): void {
  const { c } = e,
    [base, address] = e.t;
  if (i.rn === Register.PC) return emitUnsupported(e, pc);
  const lanes = (r: number) => doubleLanes(r);
  const [first, second] =
    i.form === "pair"
      ? [lanes(i.d), lanes(i.d + 1)]
      : i.form === "spaced"
        ? [lanes(i.d), lanes(i.d + SpacedStride)]
        : [doubleLanes(i.d, Lanes.PerDouble), doubleLanes(i.d + QuadSecond, Lanes.PerDouble)];
  reg(e, i.rn, pc);
  c.tee(base).set(address);
  transferLanes(
    e,
    i.load,
    address,
    first.flatMap((lane, k) => [lane, second[k] ?? 0]),
  );
  postIndex(e, pc, base, i.rn, i.rm, DoubleBytes * first.length);
}

/** VLD1/VST1 of one 32-bit lane, or VLD1 to all lanes. */
export function emitLane(e: Emitter, pc: number, i: InstructionOf<"vlane">): void {
  const { c } = e,
    [base, address] = e.t;
  if (i.rn === Register.PC || i.d + i.count > Lanes.DoubleRegisters) return emitUnsupported(e, pc);
  reg(e, i.rn, pc);
  c.tee(base).set(address);
  hostAt(e, address, 0);
  if (i.all) {
    const temp = e.laneTemp(0);
    guest(e, Op.I32Load);
    c.set(temp);
    for (const lane of doubleLanes(i.d, i.count)) {
      c.get(temp);
      setLane(e, lane);
    }
  } else if (i.load) {
    guest(e, Op.I32Load);
    setLane(e, Lanes.PerDouble * i.d + i.index);
  } else {
    getLane(e, Lanes.PerDouble * i.d + i.index);
    guest(e, Op.I32Store);
  }
  postIndex(e, pc, base, i.rn, i.rm, Word.Bytes);
}
