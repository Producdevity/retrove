import { Argument, type FoundationHost } from "../objc/host";
const STRING_CLASS = "NSString";
const ERROR_DOMAIN = "NSCocoaErrorDomain";
const ReadError = {
  Unknown: 256,
  Permission: 257,
  Missing: 260,
  Encoding: 261,
  TooLarge: 263,
} as const;
const POSIX = { Permission: 1, Missing: 2, Access: 13, TooLarge: 27 } as const;
interface StringFileHost extends Pick<
  FoundationHost,
  "method" | "alloc" | "destroy" | "autorelease" | "write"
> {
  contents(path: number): Promise<Uint8Array | undefined>;
  errno(): number;
  decode(bytes: Uint8Array, encoding: number): string | null;
  initialize(pointer: number, value: string): number;
  error(code: number, domain: string): number;
}
function fileError(errno: number): number {
  switch (errno) {
    case POSIX.Missing:
      return ReadError.Missing;
    case POSIX.Permission:
    case POSIX.Access:
      return ReadError.Permission;
    case POSIX.TooLarge:
      return ReadError.TooLarge;
    default:
      return ReadError.Unknown;
  }
}
export function installStringFiles(host: StringFileHost): void {
  for (const factory of [true, false]) {
    const selector = (factory ? "string" : "init") + "WithContentsOfFile:encoding:error:";
    host.method(STRING_CLASS, factory, selector, async (receiver, args) => {
      const path = args(0),
        encoding = args(1),
        output = args(Argument.Third);
      const bytes = await host.contents(path);
      const value = bytes === undefined ? null : host.decode(bytes, encoding);
      if (value === null) {
        const code = bytes === undefined ? fileError(host.errno()) : ReadError.Encoding;
        if (output) host.write(output, host.error(code, ERROR_DOMAIN));
        if (!factory) host.destroy(receiver);
        return 0;
      }
      const pointer = host.initialize(factory ? host.alloc(receiver) : receiver, value);
      return factory ? host.autorelease(pointer) : pointer;
    });
  }
}
