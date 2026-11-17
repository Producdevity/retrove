import { bit, field, flag } from "./bits";
import { ArmBit, ArmField, vfpRegister } from "./decode-fields";
import { decodeSimdData } from "./decode-neon-data";
import { Condition, nop, unsupported, type Instruction } from "./instruction";

const Encoding = {
  BarrierMask: 0xfffffff0,
  DataSync: 0xf57ff040,
  DataMemory: 0xf57ff050,
  InstructionSync: 0xf57ff060,
  MultipleMask: 0xff100000,
  Multiple: 0xf4000000,
  LaneMask: 0xff900000,
  Lane: 0xf4800000,
  Top: 25,
  BranchExchange: 0b1111101,
  SimdData: 0b1111001,
} as const;
const Field = {
  Type: { shift: 8, width: 4 },
  Size: { shift: 6, width: 2 },
} as const;
const Element = { Word: 0b10, AllLanes: 0b1100, OneLane: 0b1000, LaneIndex: 7, Count: 5 } as const;
const MultipleCounts: Partial<Record<number, number>> = {
  0b0111: 1,
  0b1010: 2,
  0b0110: 3,
  0b0010: 4,
};
const PairForms: Partial<Record<number, "pair" | "spaced" | "quad">> = {
  0b1000: "pair",
  0b1001: "spaced",
  0b0011: "quad",
};
const Pipeline = 8;
const Branch = { Left: 8, Right: 6, HalfShift: 1 } as const;

/** Operand registers of an Advanced SIMD encoding. */
export interface SimdRegisters {
  readonly d: number;
  readonly n: number;
  readonly m: number;
  readonly q: boolean;
}

const masked = (w: number, mask: number): number => (w & mask) >>> 0;

/** Unconditional space: barriers, BLX immediate and Advanced SIMD. */
export function decodeUnconditional(w: number, pc = 0): Instruction {
  const cond = Condition.Unconditional;
  const barrier = masked(w, Encoding.BarrierMask);
  if (
    barrier === Encoding.DataMemory ||
    barrier === Encoding.DataSync ||
    barrier === Encoding.InstructionSync
  )
    return nop();
  const registers: SimdRegisters = {
    d: vfpRegister(field(w, ArmField.Rd), bit(w, ArmBit.Double), true),
    n: vfpRegister(field(w, ArmField.Rn), bit(w, ArmBit.N), true),
    m: vfpRegister(field(w, ArmField.Rm), bit(w, ArmBit.M), true),
    q: flag(w, ArmBit.Q),
  };
  if (masked(w, Encoding.MultipleMask) === Encoding.Multiple && !flag(w, ArmBit.Up))
    return decodeElementMultiple(w, registers.d);
  if (masked(w, Encoding.LaneMask) === Encoding.Lane) return decodeElementLane(w, registers.d);
  if (w >>> Encoding.Top === Encoding.BranchExchange) {
    const offset = (w << Branch.Left) >> Branch.Right;
    const half = bit(w, ArmBit.Link) << Branch.HalfShift;
    return {
      cond: Condition.Always,
      kind: "branch",
      link: true,
      target: ((pc + Pipeline + offset + half) | 1) >>> 0,
    };
  }
  if (w >>> Encoding.Top !== Encoding.SimdData) return unsupported(cond);
  return decodeSimdData(w, registers);
}

function decodeElementMultiple(w: number, d: number): Instruction {
  const cond = Condition.Unconditional;
  const type = field(w, Field.Type),
    load = flag(w, ArmBit.Writeback),
    rn = field(w, ArmField.Rn),
    rm = field(w, ArmField.Rm);
  const count = MultipleCounts[type],
    form = PairForms[type];
  if (form)
    return field(w, Field.Size) === Element.Word
      ? { cond, kind: "vld2", load, d, form, rn, rm }
      : unsupported(cond);
  if (!count) return unsupported(cond);
  return { cond, kind: "vldst", load, d, count, rn, rm };
}

function decodeElementLane(w: number, d: number): Instruction {
  const cond = Condition.Unconditional;
  const type = field(w, Field.Type),
    load = flag(w, ArmBit.Writeback),
    rn = field(w, ArmField.Rn),
    rm = field(w, ArmField.Rm);
  if (type === Element.AllLanes && load && field(w, Field.Size) === Element.Word) {
    const count = bit(w, Element.Count) + 1;
    return { cond, kind: "vlane", load, d, index: 0, all: true, count, rn, rm };
  }
  if (type === Element.OneLane && !flag(w, ArmBit.Q)) {
    const index = bit(w, Element.LaneIndex);
    return { cond, kind: "vlane", load, d, index, all: false, count: 1, rn, rm };
  }
  return unsupported(cond);
}
