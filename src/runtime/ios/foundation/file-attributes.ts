import { Argument, type FoundationHost, type HostResult } from "../objc/host";
export interface FileMetadata {
  readonly modified?: number;
  readonly created?: number;
  readonly permissions?: number;
}
const Attribute = {
  Modified: "NSFileModificationDate",
  Created: "NSFileCreationDate",
  Permissions: "NSFilePosixPermissions",
} as const;
const Status = { Invalid: 22, Unsupported: 45 } as const;
const MILLISECONDS_PER_SECOND = 1000;
const MAX_PERMISSIONS = 0o7777;
const ERROR_DOMAIN = "NSPOSIXErrorDomain";
interface AttributeHost extends Pick<FoundationHost, "method" | "text" | "write"> {
  entries(dictionary: number): ReadonlyArray<readonly [number, number]>;
  send(self: number, selector: string, args?: number[]): Promise<HostResult>;
  isKind(self: number, className: string): boolean;
  setMetadata(path: string, metadata: FileMetadata): Promise<number>;
  error(code: number, domain: string): number;
}
async function date(host: AttributeHost, value: number): Promise<number | undefined> {
  if (!host.isKind(value, "NSDate")) return;
  const bits = await host.send(value, "timeIntervalSince1970");
  if (typeof bits !== "bigint") return;
  const scratch = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
  scratch.setBigUint64(0, bits, true);
  const milliseconds = scratch.getFloat64(0, true) * MILLISECONDS_PER_SECOND;
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}
async function attributes(host: AttributeHost, pointer: number): Promise<FileMetadata | number> {
  if (pointer && !host.isKind(pointer, "NSDictionary")) return Status.Invalid;
  let modified: number | undefined, created: number | undefined, permissions: number | undefined;
  for (const [key, value] of host.entries(pointer)) {
    switch (host.text(key)) {
      case Attribute.Modified:
        modified = await date(host, value);
        if (modified === undefined) return Status.Invalid;
        break;
      case Attribute.Created:
        created = await date(host, value);
        if (created === undefined) return Status.Invalid;
        break;
      case Attribute.Permissions: {
        if (!host.isKind(value, "NSNumber")) return Status.Invalid;
        const result = await host.send(value, "unsignedIntValue");
        if (typeof result !== "number" || result > MAX_PERMISSIONS) return Status.Invalid;
        permissions = result;
        break;
      }
      default:
        return Status.Unsupported;
    }
  }
  return {
    ...(modified === undefined ? {} : { modified }),
    ...(created === undefined ? {} : { created }),
    ...(permissions === undefined ? {} : { permissions }),
  };
}
export function installFileAttributes(host: AttributeHost): void {
  host.method("NSFileManager", false, "setAttributes:ofItemAtPath:error:", async (_, args) => {
    const update = await attributes(host, args(Argument.First));
    const status =
      typeof update === "number"
        ? update
        : await host.setMetadata(host.text(args(Argument.Second)), update);
    if (status && args(Argument.Third))
      host.write(args(Argument.Third), host.error(status, ERROR_DOMAIN));
    return Number(status === 0);
  });
}
