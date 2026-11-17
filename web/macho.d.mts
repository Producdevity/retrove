export function parseMachO(bytes: Uint8Array): unknown;
export interface FixupImage {
  readonly segments: readonly { readonly name: string; readonly address: number; readonly size: number }[];
  readonly dylibs: readonly string[];
  readonly imports: { readonly address: number; readonly name: string }[];
  readonly rebases: number[];
}
export function fixupStream(
  bytes: Uint8Array,
  image: FixupImage,
  mode: "rebase" | "normal" | "lazy" | "weak",
): void;
