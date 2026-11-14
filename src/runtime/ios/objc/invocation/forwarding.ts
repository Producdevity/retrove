import { WORD_BYTES } from "../../abi/scalars";
import type { GuestArguments, HostResult } from "../host";
import type { Invocations } from "./state";
interface ForwardHost {
  has(receiver: number, selector: string): boolean;
  send(receiver: number, selector: string, args: number[]): Promise<number>;
  release(pointer: number): Promise<void>;
}
export function invocationForwarding(host: ForwardHost, invocations: Invocations) {
  return async (
    self: number,
    selector: number,
    args: GuestArguments,
    output?: number,
  ): Promise<HostResult> => {
    if (!host.has(self, "methodSignatureForSelector:") || !host.has(self, "forwardInvocation:"))
      throw new Error("Receiver does not implement Objective-C message forwarding.");
    const signature = await host.send(self, "methodSignatureForSelector:", [selector]);
    if (!signature) throw new Error("Objective-C forwarding returned no method signature.");
    const invocation = invocations.create(signature);
    try {
      const type = invocations.get(invocation).type.result;
      if ((type.kind === "{" && type.size > WORD_BYTES) !== (output !== undefined))
        throw new Error("Objective-C forwarding return ABI mismatch.");
      invocations.capture(invocation, self, selector, args);
      await host.send(self, "forwardInvocation:", [invocation]);
      return invocations.result(invocation, output);
    } finally {
      await host.release(invocation);
    }
  };
}
