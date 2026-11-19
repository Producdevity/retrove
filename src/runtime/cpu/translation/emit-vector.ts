import {
  emitFixedConvert,
  emitWidenAdd,
  emitZeroCompare,
  emitIntegerOrder,
  emitSaturatingNarrow,
  emitShiftImmediate,
  emitVectorNot,
} from "./emit-simd-extra";
import { emitUnsupported } from "./emit-state";
import {
  emitEstimate,
  emitFloat,
  emitFloatCompare,
  emitFloatConvert,
  emitFloatSign,
  emitPairwiseAdd,
  emitPairwiseMinMax,
  emitScalarMultiply,
  emitStep,
} from "./emit-simd-float";
import {
  emitDuplicate,
  emitDuplicateCore,
  emitVectorExtract,
  emitIntegerArithmetic,
  emitLengthen,
  emitLogic,
  emitNarrow,
  emitReverse64,
  emitVectorImmediate,
} from "./emit-simd-integer";
import { emitElements, emitLane, emitPairs } from "./emit-simd-memory";
import {
  emitIntegerCompare,
  emitIntegerUnary,
  emitShiftRegister,
  emitTranspose,
  emitZip,
} from "./emit-simd-permute";
import {
  emitPrecision,
  emitVfpArithmetic,
  emitVfpCompare,
  emitVfpConvert,
  emitVfpImmediate,
  emitVfpMemory,
  emitVfpMultiple,
  emitVfpUnary,
} from "./emit-vfp";
import {
  emitCoreMove,
  emitPairMove,
  emitScalarMove,
  emitStatusMove,
  emitStatusWrite,
} from "./emit-vfp-move";
import type { Emitter } from "./emitter";
import type { Instruction } from "./instruction";

/** VFP and Advanced SIMD instructions; anything else leaves to the interpreter. */
export function emitVector(e: Emitter, pc: number, i: Instruction): void {
  switch (i.kind) {
    case "vmem":
      return emitVfpMemory(e, pc, i);
    case "vmulti":
      return emitVfpMultiple(e, pc, i);
    case "varith":
      return emitVfpArithmetic(e, i);
    case "vcvtfd":
      return emitPrecision(e, i);
    case "vunary":
      return emitVfpUnary(e, i);
    case "vmovimm":
      return emitVfpImmediate(e, i);
    case "vcmp":
      return emitVfpCompare(e, i);
    case "vcvt":
      return emitVfpConvert(e, i);
    case "vmovcore":
      return emitCoreMove(e, pc, i);
    case "vmovpair":
      return emitPairMove(e, pc, i);
    case "vmovscalar":
      return emitScalarMove(e, pc, i);
    case "vmrs":
      return emitStatusMove(e, i);
    case "vmsr":
      return emitStatusWrite(e, pc, i);
    case "vldst":
      return emitElements(e, pc, i);
    case "vld2":
      return emitPairs(e, pc, i);
    case "vlane":
      return emitLane(e, pc, i);
    default:
      return emitSimd(e, pc, i);
  }
}

function emitSimd(e: Emitter, pc: number, i: Instruction): void {
  switch (i.kind) {
    case "vfloat":
      return emitFloat(e, i);
    case "vfneg":
      return emitFloatSign(e, i);
    case "vmulscalar":
      return emitScalarMultiply(e, i);
    case "vfcvt":
      return emitFloatConvert(e, i);
    case "vfcmp":
      return emitFloatCompare(e, i);
    case "vestimate":
      return emitEstimate(e, i);
    case "vpminmax":
      return emitPairwiseMinMax(e, i);
    case "vpadd":
      return emitPairwiseAdd(e, i);
    case "vstep":
      return emitStep(e, i);
    case "vlogic":
      return emitLogic(e, i);
    case "vmovi":
      return emitVectorImmediate(e, i);
    case "vmovl":
      return emitLengthen(e, i);
    case "vext":
      return emitVectorExtract(e, i);
    case "vdup":
      return emitDuplicate(e, pc, i);
    case "vrev64":
      return emitReverse64(e, i);
    case "vmovn":
      return emitNarrow(e, i);
    case "viarith":
      return emitIntegerArithmetic(e, i);
    case "vdupcore":
      return emitDuplicateCore(e, pc, i);
    case "vzip":
      return emitZip(e, i);
    case "vicompare":
      return emitIntegerCompare(e, i);
    case "viunary":
      return emitIntegerUnary(e, i);
    case "vshlreg":
      return emitShiftRegister(e, i);
    case "vtrn":
      return emitTranspose(e, pc, i);
    case "viorder":
      return emitIntegerOrder(e, i);
    case "vmvn":
      return emitVectorNot(e, i);
    case "vshli":
      return emitShiftImmediate(e, i);
    case "vqmovn":
      return emitSaturatingNarrow(e, i);
    case "vizero":
      return emitZeroCompare(e, i);
    case "vcvtfixed":
      return emitFixedConvert(e, i);
    case "vaddw":
      return emitWidenAdd(e, i);
    default:
      return emitUnsupported(e, pc);
  }
}
