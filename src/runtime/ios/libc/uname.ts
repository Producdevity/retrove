import type { GuestArguments } from "../objc/host";
import { IOSPlatform } from "../platform";
export const UTS_NAME_BYTES = 256;
const UTS_FIELDS = [
  IOSPlatform.KernelName,
  IOSPlatform.NodeName,
  IOSPlatform.KernelRelease,
  IOSPlatform.KernelVersion,
  IOSPlatform.Model,
];
const BAD_ADDRESS = 14;
interface UnameHost {
  write(address: number, bytes: Uint8Array): void;
  fail(errno: number): number;
}
export function unameImports(host: UnameHost) {
  const result = new Uint8Array(UTS_NAME_BYTES * UTS_FIELDS.length),
    encoder = new TextEncoder();
  for (const [index, value] of UTS_FIELDS.entries())
    result.set(encoder.encode(value).subarray(0, UTS_NAME_BYTES - 1), index * UTS_NAME_BYTES);
  return {
    _uname: (args: GuestArguments): number => {
      if (!args(0)) return host.fail(BAD_ADDRESS);
      host.write(args(0), result);
      return 0;
    },
  };
}
