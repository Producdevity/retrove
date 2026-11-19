import { Argument, type FoundationHost, type HostResult } from "../objc/host";

const DATA_CLASS = "NSData";
const ERROR_DOMAIN = "NSCocoaErrorDomain";
/** NSFileReadUnknownError: what NSData reports for a URL it cannot read, network ones included. */
const READ_UNKNOWN = 256;

export interface FileURLHost {
  send(self: number, selector: string): Promise<HostResult>;
}
/** The path NSString of a file URL, or 0 for nil and non-file URLs. */
export async function fileURLPath(host: FileURLHost, url: number): Promise<number> {
  if (!url || !(await host.send(url, "isFileURL"))) return 0;
  const path = await host.send(url, "path");
  return typeof path === "number" ? path : 0;
}

interface DataURLHost
  extends
    FileURLHost,
    Pick<FoundationHost, "method" | "alloc" | "autorelease" | "destroy" | "write"> {
  contents(path: number): Promise<Uint8Array | undefined>;
  /** Initializes the NSData at `pointer` with a copy of `bytes`. */
  initialize(pointer: number, bytes: Uint8Array): number;
  error(code: number, domain: string): number;
}
/** NSData's URL readers. The runtime is offline, so only file URLs have contents. */
export function installDataURLReaders(host: DataURLHost): void {
  for (const factory of [true, false])
    for (const options of [false, true]) {
      const selector =
        (factory ? "dataWithContentsOfURL:" : "initWithContentsOfURL:") +
        (options ? "options:error:" : "");
      host.method(DATA_CLASS, factory, selector, async (receiver, args) => {
        const bytes = await host.contents(await fileURLPath(host, args(Argument.First)));
        if (!bytes) {
          const output = options ? args(Argument.Third) : 0;
          if (output) host.write(output, host.error(READ_UNKNOWN, ERROR_DOMAIN));
          if (!factory) host.destroy(receiver);
          return 0;
        }
        const pointer = host.initialize(factory ? host.alloc(receiver) : receiver, bytes);
        return factory ? host.autorelease(pointer) : pointer;
      });
    }
}
