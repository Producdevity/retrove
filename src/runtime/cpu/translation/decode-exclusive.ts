import { field, flag } from "./bits";
import { ArmField } from "./decode-fields";
import {
  ExclusiveBytes,
  Register,
  nop,
  sync,
  unsupported,
  type ExclusiveSize,
  type Instruction,
} from "./instruction";

const Arm = {
  LoadMask: 0x0f900fff,
  Load: 0x01900f9f,
  StoreMask: 0x0f900ff0,
  Store: 0x01800f90,
  Size: { shift: 21, width: 2 },
  SyncMask: 0xfffffff0,
  ClearExclusive: 0xf57ff01f,
  DataSync: 0xf57ff040,
  DataMemory: 0xf57ff050,
  InstructionSync: 0xf57ff060,
} as const;
/** LDREX/STREX size field (A1 bits 22:21, T1 op3 bits 5:4 of the B/H/D forms). */
const Sizes: readonly ExclusiveSize[] = [
  ExclusiveBytes.Word,
  ExclusiveBytes.Double,
  ExclusiveBytes.Byte,
  ExclusiveBytes.Half,
];
const Thumb = {
  /** LDREXB/H/D and STREXB/H/D: 1110 1000 110L nnnn. */
  SizedMask: 0xffe0,
  Sized: 0xe8c0,
  Load: 4,
  Rn: { shift: 0, width: 4 },
  Op3: { shift: 4, width: 4 },
  Rt: { shift: 12, width: 4 },
  Rt2: { shift: 8, width: 4 },
  Rd: { shift: 0, width: 4 },
  /** Misc control (CLREX, DSB, DMB, ISB): h1 1111 0011 1011 1111. */
  MiscControl: 0xf3bf,
  MiscOp: { shift: 4, width: 4 },
} as const;
const ThumbSizes: Partial<Record<number, ExclusiveSize>> = {
  0b0100: ExclusiveBytes.Byte,
  0b0101: ExclusiveBytes.Half,
  0b0111: ExclusiveBytes.Double,
};
const MiscOp = { ClearExclusive: 0b0010, DataSync: 0b0100, DataMemory: 0b0101, Isb: 0b0110 };

function exclusive(
  cond: number,
  load: boolean,
  size: ExclusiveSize,
  registers: {
    readonly rn: number;
    readonly rt: number;
    readonly rt2: number;
    readonly rd: number;
  },
): Instruction {
  return { cond, kind: "exclusive", load, size, offset: 0, ...registers };
}

/** ARM LDREX{B,H,D} / STREX{B,H,D}, or undefined for other multiply-space encodings. */
export function decodeArmExclusive(w: number, cond: number): Instruction | undefined {
  const load = (w & Arm.LoadMask) === Arm.Load;
  if (!load && (w & Arm.StoreMask) !== Arm.Store) return undefined;
  const size = Sizes[field(w, Arm.Size)] ?? ExclusiveBytes.Word,
    rt = field(w, load ? ArmField.Rd : ArmField.Rm);
  const double = size === ExclusiveBytes.Double;
  if (double && (rt & 1 || rt === Register.LR)) return unsupported(cond);
  const rd = load ? 0 : field(w, ArmField.Rd);
  return exclusive(cond, load, size, {
    rn: field(w, ArmField.Rn),
    rt,
    rt2: double ? rt + 1 : 0,
    rd,
  });
}

/** ARM CLREX, DSB, DMB and ISB from the unconditional space. */
export function decodeArmSync(w: number): Instruction | undefined {
  if (w >>> 0 === Arm.ClearExclusive) return sync(true);
  const masked = (w & Arm.SyncMask) >>> 0;
  return masked === Arm.DataMemory || masked === Arm.DataSync || masked === Arm.InstructionSync
    ? sync(false)
    : undefined;
}

/** Thumb LDREXB/H/D and STREXB/H/D, or undefined for other load/store dual encodings. */
export function decodeThumbExclusive(
  h1: number,
  h2: number,
  cond: number,
): Instruction | undefined {
  if ((h1 & Thumb.SizedMask) !== Thumb.Sized) return undefined;
  const size = ThumbSizes[field(h2, Thumb.Op3)];
  if (size === undefined) return undefined;
  const load = flag(h1, Thumb.Load);
  const rt = field(h2, Thumb.Rt),
    rt2 = size === ExclusiveBytes.Double ? field(h2, Thumb.Rt2) : 0;
  const rd = load ? 0 : field(h2, Thumb.Rd);
  return exclusive(cond, load, size, { rn: field(h1, Thumb.Rn), rt, rt2, rd });
}

/** Thumb misc control instructions; other encodings in the hint space stay no-ops. */
export function decodeThumbSync(h1: number, h2: number): Instruction | undefined {
  if (h1 !== Thumb.MiscControl) return undefined;
  switch (field(h2, Thumb.MiscOp)) {
    case MiscOp.ClearExclusive:
      return sync(true);
    case MiscOp.DataSync:
    case MiscOp.DataMemory:
    case MiscOp.Isb:
      return sync(false);
    default:
      return nop();
  }
}
