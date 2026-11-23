import type { GuestCPU } from "../../../cpu/cpu";
const WORD_BYTES = 4;
const ADDRESS_LIMIT = 0x1_0000_0000;
const MAXIMUM_SIGNED_COUNT = 0x7fff_ffff;
const MAXIMUM_COPY_BYTES = 1_048_576;
const ARRAY_HEADER_BYTES = 12;
const Register = { Source: 2, Capacity: 3, Destination: 4, Stack: 13 };
const ArrayField = { Buffer: 0, Count: 4, Capacity: 8 };
const STACK_DESTINATION_ARRAY = 36;
type Memory = Pick<GuestCPU, "getReg" | "read" | "write">;
function word(cpu: Memory, address: number): number {
  const bytes = cpu.read(address, WORD_BYTES);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
}
function overlaps(start: number, size: number, other: number, length: number): boolean {
  return start < other + length && other < start + size;
}
export function copyWideArray(cpu: Memory): boolean {
  const sourceArray = cpu.getReg(Register.Source);
  const destinationArray = word(cpu, cpu.getReg(Register.Stack) + STACK_DESTINATION_ARRAY);
  const count = word(cpu, sourceArray + ArrayField.Count);
  const capacity = cpu.getReg(Register.Capacity),
    output = cpu.getReg(Register.Destination);
  if (
    count === 0 ||
    count > MAXIMUM_COPY_BYTES / WORD_BYTES ||
    capacity < count ||
    capacity > MAXIMUM_SIGNED_COUNT ||
    word(cpu, destinationArray + ArrayField.Buffer) !== output ||
    word(cpu, destinationArray + ArrayField.Count) !== 0 ||
    word(cpu, destinationArray + ArrayField.Capacity) !== capacity
  )
    return false;
  const input = word(cpu, sourceArray + ArrayField.Buffer),
    size = count * WORD_BYTES;
  if (
    input + size > ADDRESS_LIMIT ||
    output + size > ADDRESS_LIMIT ||
    overlaps(input, size, output, size) ||
    overlaps(input, size, destinationArray, ARRAY_HEADER_BYTES) ||
    overlaps(output, size, sourceArray, ARRAY_HEADER_BYTES) ||
    overlaps(output, size, destinationArray, ARRAY_HEADER_BYTES)
  )
    return false;
  cpu.write(output, cpu.read(input, size));
  const bytes = new Uint8Array(WORD_BYTES);
  new DataView(bytes.buffer).setUint32(0, count, true);
  cpu.write(destinationArray + ArrayField.Count, bytes);
  return true;
}
