import { Argument, type FoundationHost, type HostResult } from "../objc/host";
const BACKUP_EXCLUSION_KEY = "NSURLIsExcludedFromBackupKey";
const CocoaError = { NoSuchFile: 4, InvalidFilename: 514, UnsupportedFeature: 3328 } as const;
const POSIX_NO_ENTRY = 2;
interface ResourceHost extends FoundationHost {
  send(self: number, name: string, args?: number[]): Promise<HostResult>;
  stat(path: number): Promise<number>;
  error(code: number, domain: string): number;
}
function pointer(value: HostResult): number {
  if (typeof value !== "number") throw new Error("Expected an Objective-C object pointer.");
  return value;
}
export function installUrlResources(host: ResourceHost): void {
  host.method("NSURL", false, "setResourceValue:forKey:error:", async (self, args) => {
    const value = args(Argument.First),
      key = host.text(args(Argument.Second)),
      output = args(Argument.Third);
    let code: number = CocoaError.InvalidFilename;
    if (await host.send(self, "isFileURL")) {
      const status = await host.stat(pointer(await host.send(self, "path")));
      if (
        status === 0 &&
        key === BACKUP_EXCLUSION_KEY &&
        value &&
        (await host.send(value, "boolValue"))
      ) {
        // Local guest files are never submitted to Apple's app-data backup service.
        return 1;
      }
      code =
        status === POSIX_NO_ENTRY ? CocoaError.NoSuchFile : status || CocoaError.UnsupportedFeature;
      if (status !== 0 && status !== POSIX_NO_ENTRY) {
        if (output) host.write(output, host.error(status, "NSPOSIXErrorDomain"));
        return 0;
      }
    }
    if (output) host.write(output, host.error(code, "NSCocoaErrorDomain"));
    return 0;
  });
}
