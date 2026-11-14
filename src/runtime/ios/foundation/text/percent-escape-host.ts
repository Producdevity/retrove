import type { FoundationHost } from "../../objc/host";
import { addPercentEscapes, replacePercentEscapes } from "./percent-escapes";
export function installPercentEscapes(
  host: Pick<FoundationHost, "method" | "text" | "string">,
): void {
  for (const [selector, transform] of [
    ["stringByAddingPercentEscapesUsingEncoding:", addPercentEscapes],
    ["stringByReplacingPercentEscapesUsingEncoding:", replacePercentEscapes],
  ] as const)
    host.method("NSString", false, selector, (self, args) => {
      const value = transform(host.text(self), args(0));
      return value === null ? 0 : host.string(value);
    });
}
