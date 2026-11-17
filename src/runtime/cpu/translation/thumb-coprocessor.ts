import { decode } from "./decode-arm";
import { Condition, unsupported, type Instruction } from "./instruction";

const Top = {
  Shift: 24,
  Store: 0xec,
  Load: 0xed,
  Data: 0xee,
  SimdMask: 0xef,
  Element: 0xf9,
} as const;
const Arm = {
  ConditionShift: 28,
  Body: 0x0fffffff,
  SimdData: 0xf2000000,
  Element: 0xf4000000,
  Low: 0x00ffffff,
  UnsignedSource: 28,
  UnsignedTarget: 24,
} as const;

/** Thumb VFP and Advanced SIMD encodings are ARM encodings with a different prefix. */
export function decodeThumbCoprocessor(w: number, cond: number): Instruction {
  const top = w >>> Top.Shift;
  let arm: number | undefined;
  if (top === Top.Store || top === Top.Load || top === Top.Data)
    arm = ((cond << Arm.ConditionShift) | (w & Arm.Body)) >>> 0;
  else if ((top & Top.SimdMask) === Top.SimdMask)
    arm =
      (Arm.SimdData | (((w >>> Arm.UnsignedSource) & 1) << Arm.UnsignedTarget) | (w & Arm.Low)) >>>
      0;
  else if (top === Top.Element) arm = (Arm.Element | (w & Arm.Low)) >>> 0;
  if (arm === undefined) return unsupported(cond);
  const decoded = decode(arm, 0);
  if (decoded.kind === "branch") return unsupported(cond);
  return top >= Top.SimdMask
    ? { ...decoded, cond: cond === Condition.Always ? Condition.Unconditional : cond }
    : decoded;
}
