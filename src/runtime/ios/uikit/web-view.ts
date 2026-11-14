import type { FoundationHost } from "../objc/host";
const CLASS = "UIWebView";
const LEGACY_PAGE_WIDTH = 980;
interface Presentation {
  scalesPageToFit: boolean;
  node?: HTMLIFrameElement;
}
interface WebViewHost extends Pick<FoundationHost, "method" | "hostClass"> {
  readonly document?: Document;
  readonly mount?: HTMLElement;
  layout(pointer: number): Partial<CSSStyleDeclaration> | undefined;
}
export class WebViews {
  private readonly values = new Map<number, Presentation>();
  constructor(private readonly host: WebViewHost) {
    host.hostClass(CLASS, "UIView");
    host.method(CLASS, false, "scalesPageToFit", (self) => Number(this.get(self).scalesPageToFit));
    host.method(CLASS, false, "setScalesPageToFit:", (self, args) => {
      this.get(self).scalesPageToFit = Boolean(args(0));
    });
  }
  private get(self: number): Presentation {
    let value = this.values.get(self);
    if (!value) {
      value = { scalesPageToFit: false };
      this.values.set(self, value);
    }
    return value;
  }
  load(self: number, html: string, base: string, finished: () => void): void {
    const { document, mount } = this.host;
    if (!document || !mount) throw new Error("UIWebView requires a browser document.");
    const value = this.get(self),
      node = document.createElement("iframe");
    value.node?.remove();
    value.node = node;
    node.sandbox.add("allow-scripts");
    node.style.cssText =
      "position:absolute;border:0;transform-origin:0 0;background:transparent;z-index:1000";
    node.addEventListener(
      "load",
      () => {
        if (this.values.get(self)?.node === node) finished();
      },
      { once: true },
    );
    const escaped = base.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
    node.srcdoc = `<base href="${escaped}">${html}`;
    mount.append(node);
    this.render();
  }
  render(): void {
    for (const [self, value] of this.values) {
      const node = value.node;
      if (!node) continue;
      const layout = this.host.layout(self);
      node.hidden = !layout;
      if (!layout) continue;
      Object.assign(node.style, layout);
      if (value.scalesPageToFit) {
        const width = Number.parseFloat(layout.width ?? "0"),
          height = Number.parseFloat(layout.height ?? "0");
        if (width > 0) {
          const scale = width / LEGACY_PAGE_WIDTH;
          node.style.width = LEGACY_PAGE_WIDTH + "px";
          node.style.height = height / scale + "px";
          node.style.transform = (layout.transform ?? "") + ` scale(${scale})`;
        }
      }
    }
  }
  remove(self: number): void {
    this.values.get(self)?.node?.remove();
    this.values.delete(self);
  }
  close(): void {
    for (const value of this.values.values()) value.node?.remove();
    this.values.clear();
  }
}
