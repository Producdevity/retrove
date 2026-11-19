import { Argument, type FoundationHost, type HostResult } from "../objc/host";
import { fileURLPath } from "./file-url-readers";
import { encodeText, StringEncoding } from "./text/encoding";
const STRING_CLASS = "NSString";
const ERROR_DOMAIN = "NSCocoaErrorDomain";
const ReadError = {
  Unknown: 256,
  Permission: 257,
  Missing: 260,
  Encoding: 261,
  TooLarge: 263,
} as const;
const WriteError = { Unknown: 512, Encoding: 517 } as const;
const POSIX = { Permission: 1, Missing: 2, Access: 13, TooLarge: 27 } as const;
const MARK_HIGH = 0xfe,
  MARK_LOW = 0xff,
  MARK_BYTES = 2;
const UTF16_MARKS = [
  [MARK_LOW, MARK_HIGH],
  [MARK_HIGH, MARK_LOW],
] as const;

interface StringFileHost extends Pick<
  FoundationHost,
  "method" | "alloc" | "destroy" | "autorelease" | "write" | "text"
> {
  send(self: number, selector: string): Promise<HostResult>;
  writeFile(path: string, bytes: Uint8Array): Promise<boolean>;
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

/** The encoding the deprecated readers infer: a UTF-16 byte order mark, then UTF-8, then MacRoman. */
function inferredText(host: StringFileHost, bytes: Uint8Array): string | null {
  const [first, second] = bytes;
  const marked = UTF16_MARKS.findIndex(([a, b]) => first === a && second === b);
  if (marked >= 0)
    return host.decode(
      bytes.subarray(MARK_BYTES),
      marked ? StringEncoding.UTF16BE : StringEncoding.UTF16LE,
    );
  return host.decode(bytes, StringEncoding.UTF8) ?? host.decode(bytes, StringEncoding.MacRoman);
}
/** stringWithContentsOfFile: and stringWithContentsOfURL:, deprecated in iOS 2 but still shipped. */
export function installInferredStringFiles(host: StringFileHost): void {
  for (const [source, toPath] of [
    ["File", (pointer: number) => Promise.resolve(pointer)],
    ["URL", (pointer: number) => fileURLPath(host, pointer)],
  ] as const)
    for (const factory of [true, false]) {
      const selector = (factory ? "string" : "init") + "WithContentsOf" + source + ":";
      host.method(STRING_CLASS, factory, selector, async (receiver, args) => {
        const bytes = await host.contents(await toPath(args(Argument.First)));
        const value = bytes === undefined ? null : inferredText(host, bytes);
        if (value === null) {
          if (!factory) host.destroy(receiver);
          return 0;
        }
        const pointer = host.initialize(factory ? host.alloc(receiver) : receiver, value);
        return factory ? host.autorelease(pointer) : pointer;
      });
    }
}
export function installStringWrites(host: StringFileHost): void {
  const write = async (self: number, path: number, encoding: number | null, output: number) => {
    const value = host.text(self);
    const bytes =
      encoding === null
        ? (encodeText(value, StringEncoding.ASCII) ?? encodeText(value, StringEncoding.UTF16))
        : encodeText(value, encoding);
    const written = !!bytes && !!path && (await host.writeFile(host.text(path), bytes));
    if (!written && output)
      host.write(
        output,
        host.error(bytes ? WriteError.Unknown : WriteError.Encoding, ERROR_DOMAIN),
      );
    return Number(written);
  };
  host.method(STRING_CLASS, false, "writeToFile:atomically:encoding:error:", (self, args) =>
    write(self, args(Argument.First), args(Argument.Third), args(Argument.Fourth)),
  );
  host.method(STRING_CLASS, false, "writeToFile:atomically:", (self, args) =>
    write(self, args(Argument.First), null, 0),
  );
  host.method(STRING_CLASS, false, "writeToURL:atomically:encoding:error:", async (self, args) =>
    write(
      self,
      await fileURLPath(host, args(Argument.First)),
      args(Argument.Third),
      args(Argument.Fourth),
    ),
  );
}
