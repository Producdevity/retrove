import type { FoundationHost } from "../../objc/host";

interface URLOpeningHost extends Pick<FoundationHost, "method" | "text"> {
  send(receiver: number, selector: string): Promise<number>;
  open(url: string): boolean;
}
const APPLICATION_CLASS = "UIApplication";
const WEB_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const STORE_SCHEMES = new Set(["itms:", "itms-apps:", "itms-appss:"]);

// The browser can only follow web and mail links; App Store schemes map to their web pages.
export function browserURL(address: string): string | undefined {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  if (STORE_SCHEMES.has(url.protocol)) return `https://${url.host}${url.pathname}${url.search}`;
  return WEB_SCHEMES.has(url.protocol) ? url.href : undefined;
}

export function installURLOpening(host: URLOpeningHost): void {
  const target = async (url: number) =>
    url ? browserURL(host.text(await host.send(url, "absoluteString"))) : undefined;
  host.method(APPLICATION_CLASS, false, "canOpenURL:", async (_, args) =>
    Number((await target(args(0))) !== undefined),
  );
  host.method(APPLICATION_CLASS, false, "openURL:", async (_, args) => {
    const address = await target(args(0));
    return Number(address !== undefined && host.open(address));
  });
}

export function openInBrowser(address: string): boolean {
  const opened = globalThis.open?.(address, "_blank");
  if (!opened) return false;
  opened.opener = null;
  return true;
}
