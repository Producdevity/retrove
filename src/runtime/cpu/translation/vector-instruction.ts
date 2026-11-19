export type VfpArithmetic = "add" | "sub" | "mul" | "nmul" | "div";
/** VMLA, VMLS, VNMLA and VNMLS: a rounded product added to (or subtracted from) the destination. */
export type VfpAccumulate = "mla" | "mls" | "nmla" | "nmls";
import type { TransferSize } from "./instruction";

export type LaneBytes = TransferSize;

type Unary = { readonly q: boolean; readonly d: number; readonly m: number };
type Binary = Unary & { readonly n: number };

type VfpInstruction =
  | {
      readonly kind: "vmem";
      readonly load: boolean;
      readonly double: boolean;
      readonly vd: number;
      readonly rn: number;
      readonly offset: number;
    }
  | {
      readonly kind: "vmulti";
      readonly load: boolean;
      readonly double: boolean;
      readonly first: number;
      readonly count: number;
      readonly rn: number;
      readonly increment: boolean;
      readonly writeback: boolean;
    }
  | {
      readonly kind: "varith";
      readonly op: VfpArithmetic | VfpAccumulate;
      readonly double: boolean;
      readonly d: number;
      readonly n: number;
      readonly m: number;
    }
  | {
      readonly kind: "vunary";
      readonly op: "mov" | "neg" | "abs" | "sqrt";
      readonly double: boolean;
      readonly d: number;
      readonly m: number;
    }
  | {
      readonly kind: "vmovimm";
      readonly double: boolean;
      readonly d: number;
      readonly bits: bigint;
    }
  | {
      readonly kind: "vcmp";
      readonly double: boolean;
      readonly d: number;
      readonly m: number | undefined;
    }
  | { readonly kind: "vcvtfd"; readonly toDouble: boolean; readonly d: number; readonly m: number }
  | {
      readonly kind: "vcvt";
      readonly toInt: boolean;
      readonly signed: boolean;
      readonly truncate: boolean;
      readonly double: boolean;
      readonly d: number;
      readonly m: number;
    }
  | { readonly kind: "vmovcore"; readonly toCore: boolean; readonly rt: number; readonly s: number }
  | {
      readonly kind: "vmovpair";
      readonly toCore: boolean;
      readonly rt: number;
      readonly rt2: number;
      readonly dm: number;
    }
  | {
      readonly kind: "vmovscalar";
      readonly bytes: LaneBytes;
      readonly index: number;
      readonly d: number;
      readonly rt: number;
      readonly toCore?: boolean;
      readonly signed?: boolean;
    }
  | { readonly kind: "vmrs"; readonly rt: number }
  /** VMSR FPSCR: the whole status word, including the comparison flags. */
  | { readonly kind: "vmsr"; readonly rt: number };

type SimdMemory =
  | {
      readonly kind: "vldst";
      readonly load: boolean;
      readonly d: number;
      readonly count: number;
      readonly rn: number;
      readonly rm: number;
    }
  | {
      readonly kind: "vld2";
      readonly load: boolean;
      readonly d: number;
      readonly form: "pair" | "spaced" | "quad";
      readonly rn: number;
      readonly rm: number;
    }
  /** VLD1/VST1 of one 32-bit lane, or VLD1 of one 32-bit element into all lanes of `count` registers. */
  | {
      readonly kind: "vlane";
      readonly load: boolean;
      readonly d: number;
      readonly index: number;
      readonly all: boolean;
      readonly count: number;
      readonly rn: number;
      readonly rm: number;
    };

type SimdInstruction =
  | (Binary & {
      readonly kind: "vlogic";
      readonly op: "and" | "bic" | "orr" | "orn" | "eor" | "bsl" | "bit" | "bif";
    })
  | { readonly kind: "vmovi"; readonly q: boolean; readonly d: number; readonly value: bigint }
  | {
      readonly kind: "vmovl";
      readonly signed: boolean;
      readonly bytes: LaneBytes;
      readonly d: number;
      readonly m: number;
    }
  | (Binary & { readonly kind: "vext"; readonly imm: number })
  | (Unary & { readonly kind: "vdup"; readonly bytes: LaneBytes; readonly index: number })
  | (Unary & { readonly kind: "vtrn"; readonly bytes: LaneBytes })
  | (Unary & { readonly kind: "vrev64" })
  | (Binary & {
      readonly kind: "vfcmp";
      readonly op: "eq" | "ge" | "gt" | "le" | "lt";
      readonly zero: boolean;
    })
  | (Unary & { readonly kind: "vestimate"; readonly sqrt: boolean })
  | { readonly kind: "vmovn"; readonly wide: boolean; readonly d: number; readonly m: number }
  | (Binary & { readonly kind: "viarith"; readonly sub: boolean })
  | {
      readonly kind: "vdupcore";
      readonly q: boolean;
      readonly d: number;
      readonly rt: number;
      readonly bytes: LaneBytes;
    }
  | (Unary & { readonly kind: "vzip"; readonly unzip: boolean; readonly bytes: LaneBytes })
  | {
      readonly kind: "vpminmax";
      readonly max: boolean;
      readonly d: number;
      readonly n: number;
      readonly m: number;
    }
  | (Binary & { readonly kind: "vicompare"; readonly test: boolean })
  /** VCGT/VCGE on 32-bit integer lanes. */
  | (Binary & { readonly kind: "viorder"; readonly ge: boolean; readonly unsigned: boolean })
  | (Unary & { readonly kind: "vmvn" })
  /** VSHL by an immediate, 32-bit lanes. */
  | (Unary & { readonly kind: "vshli"; readonly amount: number })
  /**
   * VMOVN.I16 and VQMOVN/VQMOVUN to `bytes`-wide elements (from twice that); the sticky QC flag
   * is not tracked.
   */
  | {
      readonly kind: "vqmovn";
      readonly saturate: boolean;
      readonly signedSource: boolean;
      readonly signedResult: boolean;
      readonly bytes: LaneBytes;
      readonly d: number;
      readonly m: number;
    }
  /** VCGT/VCGE/VCEQ/VCLE/VCLT against zero on signed 32-bit lanes. */
  | (Unary & { readonly kind: "vizero"; readonly op: "gt" | "ge" | "eq" | "le" | "lt" })
  /** VCVT between f32 and 32-bit fixed point with `fraction` bits. */
  | (Unary & {
      readonly kind: "vcvtfixed";
      readonly toFixed: boolean;
      readonly unsigned: boolean;
      readonly fraction: number;
    })
  /** VADDW/VSUBW: 32-bit lanes of Qn plus or minus the extended 16-bit elements of Dm. */
  | {
      readonly kind: "vaddw";
      readonly sub: boolean;
      readonly unsigned: boolean;
      readonly d: number;
      readonly n: number;
      readonly m: number;
    }
  | (Unary & { readonly kind: "viunary"; readonly abs: boolean })
  | (Binary & { readonly kind: "vshlreg"; readonly unsigned: boolean })
  | {
      readonly kind: "vpadd";
      readonly float: boolean;
      readonly d: number;
      readonly n: number;
      readonly m: number;
    }
  | (Binary & { readonly kind: "vstep"; readonly sqrt: boolean })
  | (Binary & {
      readonly kind: "vfloat";
      readonly op: "add" | "sub" | "mul" | "max" | "min" | "mla" | "mls";
    })
  | (Unary & { readonly kind: "vfneg"; readonly abs?: boolean })
  | (Binary & {
      readonly kind: "vmulscalar";
      readonly op: "mul" | "mla" | "mls";
      readonly index: number;
    })
  | (Unary & { readonly kind: "vfcvt"; readonly toInt: boolean; readonly signed: boolean });

export type VectorInstruction = VfpInstruction | SimdMemory | SimdInstruction;
