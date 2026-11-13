const WORD_BYTES = 4;
const HEXADECIMAL = 16;
interface WordPatch {
  readonly offset: number;
  readonly original: number;
  readonly replacement: number;
}
export interface PatchGroup {
  readonly name: string;
  readonly words: readonly WordPatch[];
}
export function patchExecutable(
  original: Uint8Array<ArrayBuffer>,
  groups: readonly PatchGroup[],
): Uint8Array<ArrayBuffer> {
  const words = groups.flatMap((group) => group.words);
  const input = new DataView(original.buffer, original.byteOffset, original.byteLength);
  const offsets = new Set<number>();
  for (const patch of words) {
    if (
      !Number.isSafeInteger(patch.offset) ||
      patch.offset < 0 ||
      patch.offset % WORD_BYTES ||
      patch.offset + WORD_BYTES > original.length
    )
      throw new Error("Compatibility patch is outside the executable.");
    if (offsets.has(patch.offset)) throw new Error("Compatibility patches overlap.");
    offsets.add(patch.offset);
    if (input.getUint32(patch.offset, true) !== patch.original)
      throw new Error(`Unexpected instruction at 0x${patch.offset.toString(HEXADECIMAL)}.`);
  }
  const bytes = original.slice(),
    output = new DataView(bytes.buffer);
  for (const patch of words) output.setUint32(patch.offset, patch.replacement, true);
  return bytes;
}
