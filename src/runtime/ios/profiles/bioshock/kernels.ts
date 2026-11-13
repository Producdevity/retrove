import type { GuestCPU } from "../../../../../web/cpu.mjs";
import { requiredBoneBytes, SkinningLayout, skinVertices } from "./skinning";

const WORD_BYTES = 4;
const PAGE_BYTES = 4096;
const READ_EXECUTE = 5;
const ADDRESS_LIMIT = 0x1_0000_0000;
const ARM_ABSOLUTE_JUMP = 0xe51ff004;
const PATCH_BYTES = 8;
const MAXIMUM_HOST_VERTICES = 4096;
export const SkinningEntry = {
  Address: 0x89af60,
  Continue: 0x89b4e4,
  OutputLoad: 0xe5970010,
  CountCompare: 0xe3540000,
  EpilogueLoad: 0xe59d0014,
};
const Register = { RigidCount: 4, Rigid: 6, Frame: 7, Soft: 8 };
const Frame = { SoftCount: 8, Matrices: 12, Output: 16 };
export interface KernelHost {
  readonly cpu: GuestCPU;
  readonly heap: { alloc(size: number, alignment: number): number };
  readonly gate: (name: string, run: () => { jump: number }) => number;
}
function words(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * WORD_BYTES),
    view = new DataView(bytes.buffer);
  for (const [index, value] of values.entries()) view.setUint32(index * WORD_BYTES, value, true);
  return bytes;
}
function read(cpu: GuestCPU, address: number): number {
  const bytes = cpu.read(address, WORD_BYTES);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
}
function overlaps(start: number, length: number, other: number, size: number): boolean {
  return length > 0 && size > 0 && start < other + size && other < start + length;
}
function skin(cpu: GuestCPU): boolean {
  const frame = cpu.getReg(Register.Frame);
  const rigidCount = cpu.getReg(Register.RigidCount),
    softCount = read(cpu, frame + Frame.SoftCount);
  if (rigidCount + softCount > MAXIMUM_HOST_VERTICES) return false;
  if (rigidCount + softCount === 0) return true;
  const rigid = cpu.getReg(Register.Rigid),
    soft = cpu.getReg(Register.Soft);
  const output = read(cpu, frame + Frame.Output),
    matrices = read(cpu, frame + Frame.Matrices);
  const rigidBytes = rigidCount * SkinningLayout.RigidBytes,
    softBytes = softCount * SkinningLayout.SoftBytes;
  const outputBytes = (rigidCount + softCount) * SkinningLayout.OutputBytes;
  if (
    output + outputBytes > ADDRESS_LIMIT ||
    rigid + rigidBytes > ADDRESS_LIMIT ||
    soft + softBytes > ADDRESS_LIMIT ||
    overlaps(output, outputBytes, rigid, rigidBytes) ||
    overlaps(output, outputBytes, soft, softBytes)
  )
    return false;
  const rigidInput = rigidCount ? cpu.read(rigid, rigidBytes) : new Uint8Array();
  const softInput = softCount ? cpu.read(soft, softBytes) : new Uint8Array();
  const boneBytes = Math.max(
    requiredBoneBytes(rigidInput, rigidCount, false),
    requiredBoneBytes(softInput, softCount, true),
  );
  if (matrices + boneBytes > ADDRESS_LIMIT || overlaps(output, outputBytes, matrices, boneBytes))
    return false;
  const palette = cpu.read(matrices, boneBytes),
    result = cpu.read(output, outputBytes);
  skinVertices(rigidInput, palette, result, rigidCount, false);
  skinVertices(
    softInput,
    palette,
    result.subarray(rigidCount * SkinningLayout.OutputBytes),
    softCount,
    true,
  );
  cpu.write(output, result);
  return true;
}
export function installBioShockKernels({ cpu, heap, gate }: KernelHost): void {
  if (
    read(cpu, SkinningEntry.Address) !== SkinningEntry.OutputLoad ||
    read(cpu, SkinningEntry.Address + WORD_BYTES) !== SkinningEntry.CountCompare ||
    read(cpu, SkinningEntry.Continue) !== SkinningEntry.EpilogueLoad
  )
    throw new Error("BioShock skinning instructions do not match the verified profile.");
  const fallback = heap.alloc(PAGE_BYTES, PAGE_BYTES);
  if (!fallback) throw new Error("Unable to allocate the BioShock kernel fallback.");
  cpu.write(
    fallback,
    words(
      SkinningEntry.OutputLoad,
      SkinningEntry.CountCompare,
      ARM_ABSOLUTE_JUMP,
      SkinningEntry.Address + PATCH_BYTES,
    ),
  );
  cpu.protect(fallback, PAGE_BYTES, READ_EXECUTE);
  const target = gate("BioShock skinning", () => ({
    jump: skin(cpu) ? SkinningEntry.Continue : fallback,
  }));
  cpu.write(SkinningEntry.Address, words(ARM_ABSOLUTE_JUMP, target));
}
