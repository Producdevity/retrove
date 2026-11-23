import type { GuestMemory } from "../../../memory/guest-memory";
import { Argument, type FoundationBridge } from "./types";

type NumberKind = "Int8" | "Int16" | "Int32" | "BigInt64" | "Float32" | "Float64";
const KIND_BYTES: Readonly<Record<NumberKind, number>> = {
  Int8: Int8Array.BYTES_PER_ELEMENT,
  Int16: Int16Array.BYTES_PER_ELEMENT,
  Int32: Int32Array.BYTES_PER_ELEMENT,
  BigInt64: BigInt64Array.BYTES_PER_ELEMENT,
  Float32: Float32Array.BYTES_PER_ELEMENT,
  Float64: Float64Array.BYTES_PER_ELEMENT,
};
/** CFNumberType values 1 to 16 and the storage each one reads and writes. */
const NUMBER_KINDS: Readonly<Record<number, NumberKind>> = {
  1: "Int8",
  2: "Int16",
  3: "Int32",
  4: "BigInt64",
  5: "Float32",
  6: "Float64",
  7: "Int8",
  8: "Int16",
  9: "Int32",
  10: "Int32",
  11: "BigInt64",
  12: "Float32",
  13: "Float64",
  14: "Int32",
  15: "Int32",
  16: "Float32",
};

function roundTrip(view: DataView, kind: NumberKind, value: number): number {
  switch (kind) {
    case "Int8":
      view.setInt8(0, value);
      return view.getInt8(0);
    case "Int16":
      view.setInt16(0, value, true);
      return view.getInt16(0, true);
    case "Int32":
      view.setInt32(0, value, true);
      return view.getInt32(0, true);
    case "BigInt64":
      view.setBigInt64(0, BigInt(Math.trunc(value)), true);
      return Number(view.getBigInt64(0, true));
    case "Float32":
      view.setFloat32(0, value, true);
      return view.getFloat32(0, true);
    case "Float64":
      view.setFloat64(0, value, true);
      return view.getFloat64(0, true);
  }
}

/** CFNumberGetValue: stores the number and reports whether it was represented exactly. */
export function numberValue(
  cpu: GuestMemory,
  foundation: FoundationBridge,
): (a: (index: number) => number) => number {
  return (a) => {
    const kind = NUMBER_KINDS[a(Argument.Second)],
      out = a(Argument.Third);
    const number = Number(foundation.unbox(a(0)));
    if (!kind || !out) return 0;
    if (kind === "BigInt64" && !Number.isFinite(number)) return 0;
    const bytes = new Uint8Array(KIND_BYTES[kind]);
    const actual = roundTrip(new DataView(bytes.buffer), kind, number);
    cpu.write(out, bytes);
    return Number(actual === number || (Number.isNaN(actual) && Number.isNaN(number)));
  };
}
