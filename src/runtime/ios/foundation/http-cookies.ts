import { Argument, type FoundationHost } from "../objc/host";

const STORAGE_CLASS = "NSHTTPCookieStorage";
/** NSHTTPCookieAcceptPolicyOnlyFromMainDocumentDomain, the iOS default. */
const DEFAULT_POLICY = 2;
const DOMAIN_PREFIX = ".";

export interface CookieStorageHost extends FoundationHost {
  send(receiver: number, selector: string, args?: number[]): Promise<unknown>;
  /** An autoreleased NSArray holding `items`. */
  array(items: readonly number[]): number;
  items(array: number): readonly number[];
  /** The host of an NSURL, lowercased; empty when it has none. */
  urlHost(url: number): Promise<string>;
}

export function cookieMatches(cookieDomain: string, host: string): boolean {
  const domain = cookieDomain.toLowerCase();
  if (!domain.startsWith(DOMAIN_PREFIX)) return domain === host;
  const bare = domain.slice(DOMAIN_PREFIX.length);
  return host === bare || host.endsWith(domain);
}

/** The shared cookie store. Cookies live for the session; nothing is written to disk. */
export function installCookieStorage(host: CookieStorageHost): void {
  const klass = host.hostClass(STORAGE_CLASS, "NSObject"),
    cookies: number[] = [];
  let shared = 0,
    policy = DEFAULT_POLICY;
  const domain = async (cookie: number): Promise<string> => {
    const value = await host.send(cookie, "domain");
    return typeof value === "number" && value ? host.text(value) : "";
  };
  const remove = async (cookie: number): Promise<void> => {
    const index = cookies.indexOf(cookie);
    if (index < 0) return;
    cookies.splice(index, 1);
    await host.release(cookie);
  };
  host.method(STORAGE_CLASS, true, "sharedHTTPCookieStorage", () => {
    shared ||= host.alloc(klass);
    return shared;
  });
  host.method(STORAGE_CLASS, false, "cookies", () => host.array(cookies));
  host.method(STORAGE_CLASS, false, "cookiesForURL:", async (_self, args) => {
    const name = await host.urlHost(args(Argument.First)),
      matching: number[] = [];
    if (name)
      for (const cookie of cookies)
        if (cookieMatches(await domain(cookie), name)) matching.push(cookie);
    return host.array(matching);
  });
  host.method(STORAGE_CLASS, false, "setCookie:", async (_self, args) => {
    const cookie = args(Argument.First);
    if (!cookie || cookies.includes(cookie)) return;
    cookies.push(host.retain(cookie));
  });
  host.method(STORAGE_CLASS, false, "deleteCookie:", (_self, args) => remove(args(Argument.First)));
  host.method(STORAGE_CLASS, false, "setCookies:forURL:mainDocumentURL:", async (self, args) => {
    for (const cookie of host.items(args(Argument.First)))
      await host.send(self, "setCookie:", [cookie]);
  });
  host.method(STORAGE_CLASS, false, "cookieAcceptPolicy", () => policy);
  host.method(STORAGE_CLASS, false, "setCookieAcceptPolicy:", (_self, args) => {
    policy = args(Argument.First);
  });
}
