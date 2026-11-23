import { WORD_BYTES } from "../abi/scalars";
import type { ObjcCore } from "./core";
import { standardHost } from "./core";
import type { HostResult } from "./host";
import { installInvocations } from "./invocation/bindings";
import type { MethodEncoding } from "./invocation/encoding";
import type { ForwardInvocation, Messenger } from "./messaging";
import { invocationForwarding } from "./invocation/forwarding";
import { protocolImports } from "./protocols";
import { pointerResult, returnsStructure } from "./runtime-types";

const STRUCTURE_KIND = "{";
const RESULT_BITS = 64;
const BITS_PER_BYTE = 8n;
const BYTE_MASK = 0xffn;
export type Protocols = ReturnType<typeof protocolImports>;
export interface InvocationRuntime {
  readonly protocols: Protocols;
  /** A C string that lives for the lifetime of the guest, one per distinct value. */
  readonly permanentString: (value: string) => number;
}
/** The little-endian result bytes of a scalar return value. */
function resultBytes(value: HostResult, size: number): Uint8Array {
  if (value !== undefined && typeof value !== "number" && typeof value !== "bigint")
    throw new TypeError("Cannot convert a deferred host result to an invocation return value");
  const bits = BigInt.asUintN(RESULT_BITS, BigInt(value ?? 0));
  const bytes = new Uint8Array(size);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Number((bits >> (BigInt(index) * BITS_PER_BYTE)) & BYTE_MASK);
  return bytes;
}
function forwardingOf(messenger: Messenger): ForwardInvocation {
  return (self, selector, args, output) => {
    const forward = messenger.forwardInvocation;
    if (!forward)
      throw new ReferenceError("Cannot access 'forwardInvocation' before initialization");
    return forward(self, selector, args, output);
  };
}
/** Sends an NSInvocation's message and returns its result bytes. */
function invocationCall(core: ObjcCore) {
  const { memory, registry, messenger, guest } = core;
  const forwarded = forwardingOf(messenger);
  return async (
    target: number,
    selector: number,
    args: number[],
    signature: MethodEncoding,
  ): Promise<Uint8Array> => {
    const type = signature.result,
      structure = type.kind === STRUCTURE_KIND && type.size > WORD_BYTES,
      output = structure ? memory.zero(type.size) : 0;
    await messenger.initialize(registry.record(memory.read(target)).owner);
    const name = memory.cString(selector),
      implementation = registry.lookup(memory.read(target), name);
    const argument = (index: number) => args[index] ?? 0;
    try {
      let value: HostResult;
      if (typeof implementation === "number")
        value = await guest.callGuest(
          implementation,
          structure ? [output, target, selector, ...args] : [target, selector, ...args],
          !structure && type.size > WORD_BYTES,
        );
      else if (implementation) {
        if (returnsStructure(implementation) !== structure)
          throw new Error(`Invocation return ABI mismatch for ${name}`);
        value = returnsStructure(implementation)
          ? await implementation(target, argument, output)
          : await implementation(target, argument);
      } else value = await forwarded(target, selector, argument, structure ? output : undefined);
      if (structure) return memory.bytes(output, type.size);
      return resultBytes(value, type.size);
    } finally {
      if (output) guest.heap.free(output);
    }
  };
}
/** Protocol conformance, NSMethodSignature and NSInvocation, then message forwarding through them. */
export function installInvocationRuntime(core: ObjcCore): InvocationRuntime {
  const { memory, registry, ownership, strings, messenger, late, guest } = core;
  const protocols = protocolImports({
    read: memory.read,
    cString: memory.cString,
    string: strings.string,
    text: strings.text,
  });
  for (const meta of [false, true])
    registry.method("NSObject", meta, "conformsToProtocol:", (self, args) =>
      Number(protocols.conforms(meta ? self : memory.read(self), args(0))),
    );
  const signatureStrings = new Map<string, number>();
  const permanentString = (value: string): number => {
    let pointer = signatureStrings.get(value);
    if (pointer === undefined) signatureStrings.set(value, (pointer = guest.heap.string(value)));
    return pointer;
  };
  const dispatch = () => {
    const service = late.bindings.dispatch;
    if (!service) throw new Error("Block runtime is unavailable");
    return service;
  };
  const { invocations } = installInvocations({
    ...standardHost(core),
    cString: memory.cString,
    cStringBytes: memory.cStringBytes,
    permanentString,
    copyBlock: async (pointer) => dispatch().copy(pointer),
    releaseBlock: async (pointer) => {
      await dispatch().release(pointer);
    },
    methodEncoding: (self, selector, instance) =>
      registry.typeEncoding(
        registry.lookup(instance ? self : memory.read(self), memory.cString(selector)),
      ),
    bytes: memory.bytes,
    writeBytes: memory.writeBytes,
    allocate: memory.zero,
    free: (pointer) => guest.heap.free(pointer),
    call: invocationCall(core),
  });
  messenger.forwardInvocation = invocationForwarding(
    {
      has: (self, name) => Boolean(registry.lookup(memory.read(self), name)),
      send: async (receiver, selector, args) =>
        pointerResult(await messenger.send(receiver, selector, args)),
      release: ownership.releaseFromHost,
    },
    invocations,
  );
  return { protocols, permanentString };
}
