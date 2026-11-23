import { WORD_BYTES } from "../../ios/abi/scalars";
import { write32, type GuestMemory } from "../../memory/guest-memory";
import { signed } from "./arguments";
import { MAX_GUEST_BYTES } from "./constants";

const encoder = new TextEncoder();
const terminator = Uint8Array.of(0);
const scratch = new DataView(new ArrayBuffer(WORD_BYTES));
export type NumberKind = "int" | "float" | "boolean";

export interface ViewType<T> {
  readonly BYTES_PER_ELEMENT: number;
  new (buffer: ArrayBufferLike, byteOffset: number, length: number): T;
}
export type PixelArray = Uint8Array | Uint16Array | Uint32Array | Float32Array;
export interface PixelType {
  readonly BYTES_PER_ELEMENT: number;
  new (length: number): PixelArray;
  new (buffer: ArrayBufferLike, byteOffset: number, length: number): PixelArray;
}

/** A typed view over a copy of guest memory. */
export function sourceBuffer<T>(
  cpu: GuestMemory,
  pointer: number,
  length: number,
  Type: ViewType<T>,
): T {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_GUEST_BYTES)
    throw new Error("Invalid GLES buffer length: " + length);
  const bytes = cpu.read(pointer, length);
  return new Type(bytes.buffer, bytes.byteOffset, length / Type.BYTES_PER_ELEMENT);
}
export function sourceBytes(cpu: GuestMemory, pointer: number, length: number): Uint8Array {
  return sourceBuffer(cpu, pointer, length, Uint8Array);
}

export function writeNumber(
  cpu: GuestMemory,
  pointer: number,
  value: number | boolean,
  kind: NumberKind,
): void {
  if (kind === "boolean") {
    cpu.write(pointer, Uint8Array.of(Number(value) !== 0 ? 1 : 0));
    return;
  }
  if (kind === "float") {
    scratch.setFloat32(0, Number(value), true);
    write32(cpu, pointer, scratch.getUint32(0, true));
    return;
  }
  write32(cpu, pointer, Number(value));
}

/** Writes at most `capacity - 1` bytes of `text` and a NUL, and the length written. */
export function writeString(
  cpu: GuestMemory,
  text: string | null,
  capacity: number,
  lengthPointer: number,
  destination: number,
): void {
  const bytes = encoder.encode(text || "");
  const length = Math.max(0, Math.min(bytes.length, signed(capacity) - 1));
  if (capacity > 0 && destination) {
    if (length) cpu.write(destination, bytes.subarray(0, length));
    cpu.write(destination + length, terminator);
  }
  if (lengthPointer) write32(cpu, lengthPointer, length);
}

/** A driver answer as the number a guest word holds; non-numeric answers read as zero. */
export function numeric(value: unknown): number {
  if (typeof value === "number") return value;
  return typeof value === "boolean" ? Number(value) : 0;
}
