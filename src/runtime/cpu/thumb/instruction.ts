export type ThumbInstruction =
  | {
      readonly kind: "load-float" | "store-float";
      readonly base: number;
      readonly offset: number;
      readonly lane: number;
      readonly lanes: number;
    }
  | {
      readonly kind: "add-float" | "subtract-float" | "multiply-float" | "copy-float";
      readonly destination: number;
      readonly left: number;
      readonly right: number;
    }
  | {
      readonly kind: "move-low" | "move-high";
      readonly destination: number;
      readonly immediate: number;
    }
  | { readonly kind: "add-register"; readonly destination: number; readonly source: number }
  | {
      readonly kind: "add-immediate" | "load-pointer";
      readonly destination: number;
      readonly base: number;
      readonly immediate: number;
    };
export interface DecodedThumb {
  readonly instruction: ThumbInstruction;
  readonly bytes: number;
}
export const Thumb = {
  HalfBytes: 2,
  WordBytes: 4,
  Stack: 13,
  PC: 15,
  PCBias: 4,
  Lanes: 2,
  LaneBytes: 4,
  AddressLimit: 0x1_0000_0000,
};
