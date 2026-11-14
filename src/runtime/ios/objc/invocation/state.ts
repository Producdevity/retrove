import { WORD_BYTES } from "../../abi/scalars";
import type { FoundationHost, GuestArguments, HostResult } from "../host";
import { IMPLICIT_ARGUMENTS, wordLength, type MethodEncoding } from "./encoding";
export const INVOCATION_CLASS = "NSInvocation";
const BITS_PER_BYTE = 8;
const SIGN_SHIFT = { Byte: 24, Short: 16 } as const;
const HIGH_WORD = 32n;
const WORD_MASK = 0xffff_ffffn;
export interface InvocationHost extends Pick<
  FoundationHost,
  "hostClass" | "method" | "alloc" | "autorelease" | "destroy" | "retain" | "release"
> {
  bytes(pointer: number, size: number): Uint8Array;
  writeBytes(pointer: number, bytes: Uint8Array): void;
  allocate(size: number): number;
  free(pointer: number): void;
  cStringBytes(pointer: number): Uint8Array;
  copyBlock(pointer: number): Promise<number>;
  releaseBlock(pointer: number): Promise<void>;
  permanentString(value: string): number;
  call(
    target: number,
    selector: number,
    words: number[],
    signature: MethodEncoding,
  ): Promise<Uint8Array>;
}
interface Invocation {
  readonly signature: number;
  readonly type: MethodEncoding;
  readonly args: Uint8Array[];
  result: Uint8Array;
  retained: boolean;
  readonly cStrings: Map<number, number>;
}
export function loadWord(bytes: Uint8Array): number {
  let value = 0;
  for (let index = 0; index < Math.min(WORD_BYTES, bytes.length); index++)
    value |= (bytes[index] ?? 0) << (index * BITS_PER_BYTE);
  return value >>> 0;
}
export function wordsOf(bytes: Uint8Array): number[] {
  return Array.from({ length: wordLength(bytes.length) }, (_, index) =>
    loadWord(bytes.subarray(index * WORD_BYTES)),
  );
}
const wordBytes = (value: number) => {
  const bytes = new Uint8Array(WORD_BYTES);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};
export class Invocations {
  readonly cls: number;
  readonly states = new Map<number, Invocation>();
  constructor(
    readonly host: InvocationHost,
    readonly signature: (pointer: number) => MethodEncoding,
  ) {
    this.cls = host.hostClass(INVOCATION_CLASS, "NSObject");
  }
  get(self: number): Invocation {
    const value = this.states.get(self);
    if (!value) throw new Error("Invalid NSInvocation.");
    return value;
  }
  create(signature: number): number {
    const type = this.signature(signature),
      self = this.host.alloc(this.cls);
    this.states.set(self, {
      signature: this.host.retain(signature),
      type,
      args: type.arguments.map((value) => new Uint8Array(value.size)),
      result: new Uint8Array(type.result.size),
      retained: false,
      cStrings: new Map(),
    });
    return self;
  }
  argument(self: number, index: number): Uint8Array {
    const value = this.get(self).args[index];
    if (!value) throw new Error("NSInvocation argument index out of range.");
    return value;
  }
  async setArgument(self: number, index: number, bytes: Uint8Array): Promise<void> {
    const state = this.get(self),
      previous = this.argument(self, index);
    if (bytes.length !== previous.length) throw new Error("Invalid NSInvocation argument size.");
    const value = bytes.slice();
    if (state.retained) {
      const next: Invocation = { ...state, args: [...state.args], cStrings: new Map() };
      next.args[index] = value;
      await this.retainArgument(next, index, value);
      try {
        await this.releaseArgument(state, index);
      } catch (error) {
        await this.releaseArgument(next, index);
        throw error;
      }
      const copy = next.cStrings.get(index);
      if (copy) state.cStrings.set(index, copy);
    }
    state.args[index] = value;
  }
  async retainArgument(state: Invocation, index: number, bytes: Uint8Array): Promise<void> {
    const type = state.type.arguments[index],
      pointer = loadWord(bytes);
    if (type?.kind === "@") {
      if (type.encoding.endsWith("@?")) bytes.set(wordBytes(await this.host.copyBlock(pointer)));
      else this.host.retain(pointer);
    }
    if (type?.kind === "*" && pointer) {
      const source = this.host.cStringBytes(pointer),
        data = new Uint8Array(source.length + 1);
      data.set(source);
      const copy = this.host.allocate(data.length);
      this.host.writeBytes(copy, data);
      bytes.set(wordBytes(copy));
      state.cStrings.set(index, copy);
    }
  }
  async releaseArgument(state: Invocation, index: number): Promise<void> {
    const type = state.type.arguments[index],
      pointer = loadWord(state.args[index] ?? new Uint8Array());
    if (type?.kind === "@") {
      if (type.encoding.endsWith("@?")) await this.host.releaseBlock(pointer);
      else await this.host.release(pointer);
    }
    const copy = state.cStrings.get(index);
    if (copy) {
      this.host.free(copy);
      state.cStrings.delete(index);
    }
  }
  async retainArguments(self: number): Promise<void> {
    const state = this.get(self);
    if (state.retained) return;
    const next: Invocation = {
      ...state,
      args: state.args.map((bytes) => bytes.slice()),
      cStrings: new Map(),
    };
    let owned = 0;
    try {
      for (const [index, bytes] of next.args.entries()) {
        await this.retainArgument(next, index, bytes);
        owned++;
      }
    } catch (error) {
      for (let index = 0; index < owned; index++) await this.releaseArgument(next, index);
      throw error;
    }
    state.args.splice(0, state.args.length, ...next.args);
    for (const [index, copy] of next.cStrings) state.cStrings.set(index, copy);
    state.retained = true;
  }
  async destroy(self: number): Promise<void> {
    const state = this.get(self);
    this.states.delete(self);
    if (state.retained)
      for (let index = 0; index < state.args.length; index++)
        await this.releaseArgument(state, index);
    await this.host.release(state.signature);
    this.host.destroy(self);
  }
  capture(self: number, target: number, selector: number, args: GuestArguments): void {
    const state = this.get(self);
    state.args[0] = wordBytes(target);
    state.args[1] = wordBytes(selector);
    let cursor = 0;
    for (const bytes of state.args.slice(IMPLICIT_ARGUMENTS)) {
      const view = new DataView(new ArrayBuffer(wordLength(bytes.length) * WORD_BYTES));
      for (let index = 0; index < view.byteLength; index += WORD_BYTES)
        view.setUint32(index, args(cursor++), true);
      bytes.set(new Uint8Array(view.buffer).subarray(0, bytes.length));
    }
  }
  async invoke(self: number): Promise<void> {
    const state = this.get(self),
      target = loadWord(this.argument(self, 0)),
      selector = loadWord(this.argument(self, 1));
    if (!selector) throw new Error("NSInvocation has no selector.");
    state.result = target
      ? await this.host.call(
          target,
          selector,
          state.args.slice(IMPLICIT_ARGUMENTS).flatMap(wordsOf),
          state.type,
        )
      : new Uint8Array(state.type.result.size);
  }
  result(self: number, output?: number): HostResult {
    const state = this.get(self),
      bytes = state.result;
    if (output !== undefined) {
      this.host.writeBytes(output, bytes);
      return output;
    }
    if (bytes.length > WORD_BYTES) {
      const words = wordsOf(bytes);
      return (BigInt(words[1] ?? 0) << HIGH_WORD) | (BigInt(words[0] ?? 0) & WORD_MASK);
    }
    const value = loadWord(bytes),
      kind = state.type.result.kind;
    if (kind === "c") return (value << SIGN_SHIFT.Byte) >> SIGN_SHIFT.Byte;
    if (kind === "s") return (value << SIGN_SHIFT.Short) >> SIGN_SHIFT.Short;
    return value;
  }
}
