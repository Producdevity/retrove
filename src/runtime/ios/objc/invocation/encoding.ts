import { WORD_BYTES } from "../../abi/scalars";
export const IMPLICIT_ARGUMENTS = 2;
const MAX_TYPE_BYTES = 1_048_576;
const MAX_NESTING = 64;
const QUALIFIERS = "rnNoORV";
const POINTER_TYPES = "@#:*^?";
const SCALAR_SIZE: Readonly<Record<string, number>> = {
  v: 0,
  c: 1,
  C: 1,
  B: 1,
  s: 2,
  S: 2,
  i: 4,
  I: 4,
  l: 4,
  L: 4,
  f: 4,
  q: 8,
  Q: 8,
  d: 8,
};
export interface EncodedType {
  readonly encoding: string;
  readonly kind: string;
  readonly size: number;
  readonly alignment: number;
}
export interface MethodEncoding {
  readonly result: EncodedType;
  readonly arguments: EncodedType[];
  readonly frameLength: number;
  readonly oneway: boolean;
}
export const wordLength = (bytes: number) => Math.ceil(bytes / WORD_BYTES);
const align = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment;
class TypeReader {
  index = 0;
  constructor(readonly source: string) {}
  quoted(): void {
    if (this.source[this.index++] !== '"') throw new Error("Invalid Objective-C type name.");
    while (this.index < this.source.length) if (this.source[this.index++] === '"') return;
    throw new Error("Unterminated Objective-C type name.");
  }
  number(): number | undefined {
    const start = this.index;
    if (this.source[this.index] === "+" || this.source[this.index] === "-") this.index++;
    while (/\d/.test(this.source[this.index] ?? "")) this.index++;
    return start === this.index ? undefined : Number(this.source.slice(start, this.index));
  }
  type(depth = 0): EncodedType {
    if (depth > MAX_NESTING) throw new Error("Objective-C type nesting limit exceeded.");
    const start = this.index;
    while (QUALIFIERS.includes(this.source[this.index] ?? "\0")) this.index++;
    const kind = this.source[this.index++];
    if (!kind) throw new Error("Missing Objective-C type.");
    let size = SCALAR_SIZE[kind],
      alignment = Math.min(size ?? WORD_BYTES, WORD_BYTES);
    if (POINTER_TYPES.includes(kind)) {
      size = WORD_BYTES;
      alignment = WORD_BYTES;
      if (kind === "^") this.type(depth + 1);
      if (kind === "@" && this.source[this.index] === "?") this.index++;
      else if (kind === "@" && this.source[this.index] === '"') this.quoted();
    } else if (kind === "[") {
      const count = this.number(),
        member = this.type(depth + 1);
      if (count === undefined || count < 0 || this.source[this.index++] !== "]")
        throw new Error("Invalid Objective-C array type.");
      size = count * member.size;
      alignment = member.alignment;
    } else if (kind === "{") {
      while (this.index < this.source.length && !"=}".includes(this.source[this.index] ?? ""))
        this.index++;
      if (this.source[this.index++] !== "=") throw new Error("Opaque Objective-C structure.");
      size = 0;
      alignment = 1;
      while (this.index < this.source.length && this.source[this.index] !== "}") {
        if (this.source[this.index] === '"') this.quoted();
        const member = this.type(depth + 1);
        alignment = Math.max(alignment, member.alignment);
        size = align(size, member.alignment) + member.size;
      }
      if (this.source[this.index++] !== "}") throw new Error("Unterminated Objective-C structure.");
      size = align(size, alignment);
    }
    if (size === undefined) throw new Error(`Unsupported Objective-C type ${kind}.`);
    if (!Number.isSafeInteger(size) || size > MAX_TYPE_BYTES)
      throw new Error("Objective-C type size limit exceeded.");
    return {
      encoding: this.source.slice(start, this.index),
      kind,
      size,
      alignment: alignment || 1,
    };
  }
}
export function parseMethodEncoding(source: string): MethodEncoding {
  const reader = new TypeReader(source),
    result = reader.type();
  reader.number();
  const args: EncodedType[] = [];
  while (reader.index < source.length) {
    const value = reader.type();
    if (!value.size) throw new Error("Void Objective-C argument.");
    args.push(value);
    reader.number();
  }
  if (
    args.length < IMPLICIT_ARGUMENTS ||
    !["@", "#"].includes(args[0]?.kind ?? "") ||
    args[1]?.kind !== ":"
  )
    throw new Error("Objective-C method signature lacks self and selector.");
  return {
    result,
    arguments: args,
    frameLength: args.reduce((sum, value) => sum + wordLength(value.size) * WORD_BYTES, 0),
    oneway: result.encoding.startsWith("V"),
  };
}
