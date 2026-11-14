import { Argument } from "../objc/host";
import type { FoundationHost } from "../objc/host";
export const ErrorField = { Code: 4, Domain: 8, UserInfo: 12 } as const;
export const ERROR_INSTANCE_BYTES = 16;
const ERROR_CLASS = "NSError";
const POSIX_ERROR_DOMAIN = "NSPOSIXErrorDomain";
const URL_ERROR_DOMAIN = "NSURLErrorDomain";
const URLError = { Offline: -1009, MissingFile: -1100 } as const;
const ErrorInfo = {
  Description: "NSLocalizedDescription",
  FailureReason: "NSLocalizedFailureReason",
  RecoverySuggestion: "NSLocalizedRecoverySuggestion",
  RecoveryOptions: "NSLocalizedRecoveryOptions",
  HelpAnchor: "NSHelpAnchor",
} as const;
interface ErrorHost extends Pick<
  FoundationHost,
  | "method"
  | "alloc"
  | "destroy"
  | "autorelease"
  | "retain"
  | "release"
  | "text"
  | "string"
  | "write"
> {
  read(pointer: number): number;
  send(pointer: number, selector: string, args: number[]): Promise<number>;
  dictionary(): number;
}
async function infoValue(host: ErrorHost, self: number, key: string): Promise<number> {
  const info = host.read(self + ErrorField.UserInfo);
  return info ? host.send(info, "objectForKey:", [host.string(key)]) : 0;
}
async function initialize(
  host: ErrorHost,
  self: number,
  domain: number,
  code: number,
  info: number,
): Promise<number> {
  if (!domain) throw new Error("NSError requires a non-nil domain.");
  const oldDomain = host.read(self + ErrorField.Domain),
    oldInfo = host.read(self + ErrorField.UserInfo);
  const copyDomain = await host.send(domain, "copy", []);
  let copyInfo = 0;
  try {
    if (info) copyInfo = await host.send(info, "copy", []);
  } catch (error) {
    await host.release(copyDomain);
    throw error;
  }
  host.write(self + ErrorField.Domain, copyDomain);
  host.write(self + ErrorField.Code, code);
  host.write(self + ErrorField.UserInfo, copyInfo);
  await host.release(oldDomain);
  await host.release(oldInfo);
  return self;
}
export function installErrors(host: ErrorHost): void {
  host.method(ERROR_CLASS, false, "initWithDomain:code:userInfo:", (self, args) =>
    initialize(host, self, args(0), args(1), args(Argument.Third)),
  );
  host.method(ERROR_CLASS, true, "errorWithDomain:code:userInfo:", async (cls, args) => {
    const self = host.alloc(cls);
    try {
      return host.autorelease(await initialize(host, self, args(0), args(1), args(Argument.Third)));
    } catch (error) {
      host.destroy(self);
      throw error;
    }
  });
  host.method(ERROR_CLASS, false, "code", (self) => host.read(self + ErrorField.Code) | 0);
  host.method(
    ERROR_CLASS,
    false,
    "domain",
    (self) => host.read(self + ErrorField.Domain) || host.string(POSIX_ERROR_DOMAIN),
  );
  host.method(
    ERROR_CLASS,
    false,
    "userInfo",
    (self) => host.read(self + ErrorField.UserInfo) || host.dictionary(),
  );
  host.method(ERROR_CLASS, false, "localizedDescription", async (self) => {
    const description = await infoValue(host, self, ErrorInfo.Description);
    if (description) return description;
    const code = host.read(self + ErrorField.Code) | 0,
      domain = host.read(self + ErrorField.Domain);
    const name = domain ? host.text(domain) : POSIX_ERROR_DOMAIN;
    if (name === URL_ERROR_DOMAIN && code === URLError.Offline)
      return host.string("The internet connection appears to be offline.");
    if (name === URL_ERROR_DOMAIN && code === URLError.MissingFile)
      return host.string("The requested file could not be found.");
    return host.string(name + " error " + code);
  });
  for (const [selector, key] of [
    ["localizedFailureReason", ErrorInfo.FailureReason],
    ["localizedRecoverySuggestion", ErrorInfo.RecoverySuggestion],
    ["localizedRecoveryOptions", ErrorInfo.RecoveryOptions],
    ["helpAnchor", ErrorInfo.HelpAnchor],
  ]) {
    if (selector && key)
      host.method(ERROR_CLASS, false, selector, (self) => infoValue(host, self, key));
  }
  host.method(ERROR_CLASS, false, "copy", host.retain);
  host.method(ERROR_CLASS, false, "dealloc", async (self) => {
    await host.release(host.read(self + ErrorField.Domain));
    await host.release(host.read(self + ErrorField.UserInfo));
    host.destroy(self);
  });
}
