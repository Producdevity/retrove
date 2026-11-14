import { INVOCATION_CLASS, Invocations, loadWord } from "./state";
import type { InvocationHost } from "./state";
import { SIGNATURE_CLASS, installSignatures, type SignatureHost } from "./signatures";
import type { HostMethod } from "../host";
import { WORD_BYTES } from "../../abi/scalars";
export function installInvocations(host: InvocationHost & SignatureHost) {
  const signatures = installSignatures(host),
    invocations = new Invocations(host, signatures.get);
  const method = (name: string, fn: HostMethod) => host.method(INVOCATION_CLASS, false, name, fn);
  host.method(INVOCATION_CLASS, true, "invocationWithMethodSignature:", (_, args) =>
    host.autorelease(invocations.create(args(0))),
  );
  method("methodSignature", (self) => invocations.get(self).signature);
  for (const [name, setter, index] of [
    ["target", "setTarget:", 0],
    ["selector", "setSelector:", 1],
  ] as const) {
    method(name, (self) => loadWord(invocations.argument(self, index)));
    method(setter, async (self, args) => {
      const bytes = new Uint8Array(WORD_BYTES);
      new DataView(bytes.buffer).setUint32(0, args(0), true);
      await invocations.setArgument(self, index, bytes);
    });
  }
  method("getArgument:atIndex:", (self, args) =>
    host.writeBytes(args(0), invocations.argument(self, args(1))),
  );
  method("setArgument:atIndex:", (self, args) =>
    invocations.setArgument(
      self,
      args(1),
      host.bytes(args(0), invocations.argument(self, args(1)).length),
    ),
  );
  method("getReturnValue:", (self, args) => host.writeBytes(args(0), invocations.get(self).result));
  method("setReturnValue:", (self, args) => {
    const state = invocations.get(self);
    state.result = host.bytes(args(0), state.type.result.size).slice();
  });
  method("retainArguments", (self) => invocations.retainArguments(self));
  method("argumentsRetained", (self) => Number(invocations.get(self).retained));
  method("invoke", (self) => invocations.invoke(self));
  method("invokeWithTarget:", async (self, args) => {
    const bytes = new Uint8Array(WORD_BYTES);
    new DataView(bytes.buffer).setUint32(0, args(0), true);
    await invocations.setArgument(self, 0, bytes);
    await invocations.invoke(self);
  });
  method("dealloc", (self) => invocations.destroy(self));
  return { invocations, signatures, signatureClass: SIGNATURE_CLASS };
}
