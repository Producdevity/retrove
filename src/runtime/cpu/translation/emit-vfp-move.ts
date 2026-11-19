import { reg } from "./emit-access";
import { Lanes, Word } from "./emit-constants";
import { getLane, setLane } from "./emit-float";
import { emitUnsupported } from "./emit-state";
import type { Emitter } from "./emitter";
import { AccessBytes, Register, type InstructionOf } from "./instruction";
import { Op } from "./wasm-opcodes";
import { relative } from "./layout";

const Status = { Flags: 0x0fffffff, N: 31, Z: 30, C: 29, V: 28 } as const;

export function emitCoreMove(e: Emitter, pc: number, i: InstructionOf<"vmovcore">): void {
  if (i.rt === Register.PC) return emitUnsupported(e, pc);
  if (i.toCore) {
    getLane(e, i.s);
    e.c.set(e.register(i.rt));
  } else {
    reg(e, i.rt, pc);
    setLane(e, i.s);
  }
}

export function emitPairMove(e: Emitter, pc: number, i: InstructionOf<"vmovpair">): void {
  const { c } = e,
    temp = e.laneTemp(0),
    low = Lanes.PerDouble * i.dm;
  if (i.rt === Register.PC || i.rt2 === Register.PC) return emitUnsupported(e, pc);
  if (i.toCore) {
    getLane(e, low);
    c.set(temp);
    getLane(e, low + 1);
    c.set(e.register(i.rt2));
    c.get(temp).set(e.register(i.rt));
  } else {
    reg(e, i.rt, pc);
    setLane(e, low);
    reg(e, i.rt2, pc);
    setLane(e, low + 1);
  }
}

export function emitScalarMove(e: Emitter, pc: number, i: InstructionOf<"vmovscalar">): void {
  const { c } = e;
  const lane = Lanes.PerDouble * i.d + Math.floor((i.index * i.bytes) / Word.Bytes);
  const shift = ((i.index * i.bytes) % Word.Bytes) * Word.ByteBits;
  if (i.toCore) {
    const width = i.bytes * Word.ByteBits;
    getLane(e, lane);
    if (i.bytes !== AccessBytes.Word) {
      c.i32(Word.Bits - shift - width)
        .op(Op.I32Shl)
        .i32(Word.Bits - width);
      c.op(i.signed ? Op.I32ShrS : Op.I32ShrU);
    }
    c.set(e.register(i.rt));
    return;
  }
  if (i.bytes === AccessBytes.Word) {
    reg(e, i.rt, pc);
    setLane(e, lane);
    return;
  }
  const mask = i.bytes === AccessBytes.Half ? Word.Half : Word.Byte;
  getLane(e, lane);
  c.i32(~(mask << shift)).op(Op.I32And);
  reg(e, i.rt, pc);
  c.i32(mask).op(Op.I32And).i32(shift).op(Op.I32Shl).op(Op.I32Or);
  setLane(e, lane);
}

/** VMRS reads FPSCR with the cached flags; `APSR_nzcv` (Rt = PC) copies them to the core flags. */
export function emitStatusMove(e: Emitter, i: InstructionOf<"vmrs">): void {
  const { c } = e,
    fp = e.fpFlags,
    core = e.flags;
  if (i.rt === Register.PC) {
    c.get(fp.n).set(core.n).get(fp.z).set(core.z).get(fp.c).set(core.c).get(fp.v).set(core.v);
    return;
  }
  c.arena().memory(Op.I32Load, relative(e.L, e.L.fpscr)).i32(Status.Flags).op(Op.I32And);
  c.get(fp.n).i32(Status.N).op(Op.I32Shl).op(Op.I32Or).get(fp.z).i32(Status.Z).op(Op.I32Shl);
  c.op(Op.I32Or).get(fp.c).i32(Status.C).op(Op.I32Shl).op(Op.I32Or);
  c.get(fp.v).i32(Status.V).op(Op.I32Shl).op(Op.I32Or).set(e.register(i.rt));
}
