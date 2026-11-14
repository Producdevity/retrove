import { doubleFromBits } from "../abi/scalars";
import type { GuestArguments, HostResult } from "../objc/host";
const MILLISECONDS_PER_SECOND = 1000;
interface ThreadWaitHost {
  now(): number;
  wallTime(): number;
  send(self: number, selector: string): Promise<HostResult>;
  classMethod(
    selector: string,
    method: (
      args: GuestArguments,
    ) => Promise<{ wait(): number | undefined }> | { wait(): number | undefined },
  ): void;
}
export function installThreadWaits(host: ThreadWaitHost): void {
  const sleep = (milliseconds: number) => {
    if (!Number.isFinite(milliseconds)) throw new Error("Invalid thread sleep interval.");
    const deadline = host.now() + Math.max(0, milliseconds);
    return { wait: () => (host.now() >= deadline ? 0 : undefined) };
  };
  host.classMethod("sleepForTimeInterval:", (args) =>
    sleep(doubleFromBits(args(0), args(1)) * MILLISECONDS_PER_SECOND),
  );
  host.classMethod("sleepUntilDate:", async (args) => {
    const result = await host.send(args(0), "timeIntervalSince1970");
    if (typeof result !== "bigint") throw new Error("Invalid thread sleep date.");
    const bits = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
    bits.setBigUint64(0, result, true);
    return sleep(bits.getFloat64(0, true) * MILLISECONDS_PER_SECOND - host.wallTime());
  });
}
