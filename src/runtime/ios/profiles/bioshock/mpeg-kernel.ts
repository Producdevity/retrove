import type { GuestCPU } from "../../../../../web/cpu.mjs";
import type { KernelHost } from "./kernels";
import { MpegSynthesisLayout, synthesizeMpeg } from "./mpeg-synthesis";

const WORD_BYTES = 4;
const PATCH_BYTES = 8;
const PAGE_BYTES = 4096;
const READ_EXECUTE = 5;
const ADDRESS_LIMIT = 0x1_0000_0000;
const THUMB_ABSOLUTE_JUMP = 0xf000f8df;
const THUMB_STATE = 1;
export const MpegEntry = {
  Address: 0x4ba0c4,
  Frame: 0xaf03b5f0,
  SavedRegisters: 0x0d00e92d,
  Epilogue: 0x4ba4de,
  ReturnValue: 0xb0012000,
  WindowPointer: 0x1ad4828,
};
const Register = { Result: 0, Input: 1, Phase: 2, Channels: 3, Stack: 13, Return: 14 };
function word(cpu: GuestCPU, address: number): number {
  const bytes = cpu.read(address, WORD_BYTES);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
}
function words(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * WORD_BYTES),
    view = new DataView(bytes.buffer);
  for (const [index, value] of values.entries()) view.setUint32(index * WORD_BYTES, value, true);
  return bytes;
}
function overlaps(start: number, size: number, other: number, length: number): boolean {
  return start < other + length && other < start + size;
}
function synthesize(cpu: GuestCPU): boolean {
  const phase = cpu.getReg(Register.Phase),
    channels = cpu.getReg(Register.Channels);
  if (
    phase > MpegSynthesisLayout.MaximumPhase ||
    channels < 1 ||
    channels > MpegSynthesisLayout.MaximumChannels
  )
    return false;
  const input = cpu.getReg(Register.Input),
    output = word(cpu, cpu.getReg(Register.Stack));
  const window = word(cpu, word(cpu, MpegEntry.WindowPointer));
  const size =
    ((MpegSynthesisLayout.OutputSamples - 1) * channels + 1) * MpegSynthesisLayout.SampleBytes;
  if (
    input + MpegSynthesisLayout.InputBytes > ADDRESS_LIMIT ||
    window + MpegSynthesisLayout.WindowBytes > ADDRESS_LIMIT ||
    output + size > ADDRESS_LIMIT ||
    overlaps(output, size, input, MpegSynthesisLayout.InputBytes) ||
    overlaps(output, size, window, MpegSynthesisLayout.WindowBytes)
  )
    return false;
  const result = cpu.read(output, size);
  synthesizeMpeg(
    cpu.read(input, MpegSynthesisLayout.InputBytes),
    cpu.read(window, MpegSynthesisLayout.WindowBytes),
    phase,
    channels,
    result,
  );
  cpu.write(output, result);
  cpu.setReg(Register.Result, 0);
  return true;
}
export function verifyBioShockAudioKernel(cpu: GuestCPU): void {
  if (
    word(cpu, MpegEntry.Address) !== MpegEntry.Frame ||
    word(cpu, MpegEntry.Address + WORD_BYTES) !== MpegEntry.SavedRegisters ||
    word(cpu, MpegEntry.Epilogue) !== MpegEntry.ReturnValue
  )
    throw new Error("BioShock MPEG instructions do not match the verified profile.");
}
export function installBioShockAudioKernel({ cpu, heap, gate }: KernelHost): void {
  verifyBioShockAudioKernel(cpu);
  const fallback = heap.alloc(PAGE_BYTES, PAGE_BYTES);
  if (!fallback) throw new Error("Unable to allocate the BioShock MPEG fallback.");
  cpu.write(
    fallback,
    words(
      MpegEntry.Frame,
      MpegEntry.SavedRegisters,
      THUMB_ABSOLUTE_JUMP,
      MpegEntry.Address + PATCH_BYTES + THUMB_STATE,
    ),
  );
  cpu.protect(fallback, PAGE_BYTES, READ_EXECUTE);
  const target = gate("BioShock MPEG synthesis", () => ({
    jump: synthesize(cpu) ? cpu.getReg(Register.Return) : fallback + THUMB_STATE,
  }));
  cpu.write(MpegEntry.Address, words(THUMB_ABSOLUTE_JUMP, target));
}
