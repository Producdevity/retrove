import { Argument, type GuestArguments, type HostResult } from "../objc/host";

const RELEASE_STAGE = 0x80;
const STAGE_SHIFT = 8;
const MINOR_SHIFT = 20;
const BUGFIX_SHIFT = 16;
const MAJOR_SHIFT = 24;
const DECIMAL = 10;
const NIBBLE = 16;
const MAX_MAJOR = 99;
const MAX_DIGIT = 9;

/**
 * CFBundleGetVersionNumber's 'vers' resource layout for a CFBundleVersion such as "1.0.2":
 * a two-digit BCD major, one BCD digit each for minor and bug fix, then the release stage.
 */
export function bundleVersionNumber(version: string | undefined): number {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u.exec(version?.trim() ?? "");
  if (!match) return 0;
  const [major, minor, bugfix] = match
    .slice(1)
    .map((part) => Number.parseInt(part ?? "0", DECIMAL));
  if (major === undefined || minor === undefined || bugfix === undefined) return 0;
  if (major > MAX_MAJOR || minor > MAX_DIGIT || bugfix > MAX_DIGIT) return 0;
  const bcdMajor = Math.floor(major / DECIMAL) * NIBBLE + (major % DECIMAL);
  return (
    ((bcdMajor << MAJOR_SHIFT) |
      (minor << MINOR_SHIFT) |
      (bugfix << BUGFIX_SHIFT) |
      (RELEASE_STAGE << STAGE_SHIFT)) >>>
    0
  );
}

export interface BundleFunctionHost {
  readonly version: string | undefined;
  mainBundle(): Promise<number> | number;
  /** A retained file NSURL for an absolute or relative path. */
  fileURL(path: string, directory: boolean): Promise<number>;
  readBytes(pointer: number, length: number): Uint8Array;
}

/** The CFBundle and CFURL entry points apps use to find their bundle and version. */
export function bundleFunctions(
  host: BundleFunctionHost,
): Record<string, (args: GuestArguments) => HostResult | Promise<HostResult>> {
  const decoder = new TextDecoder();
  return {
    // CFAllocatorGetDefault's result is only passed back to CF, which treats NULL as the default.
    _CFAllocatorGetDefault: () => 0,
    _CFBundleGetMainBundle: () => host.mainBundle(),
    _CFBundleGetVersionNumber: () => bundleVersionNumber(host.version),
    _CFURLCreateFromFileSystemRepresentation: (args) => {
      const buffer = args(Argument.Second),
        length = args(Argument.Third);
      if (!buffer) return 0;
      const path = decoder.decode(host.readBytes(buffer, length));
      return host.fileURL(path, Boolean(args(Argument.Fourth)));
    },
  };
}
