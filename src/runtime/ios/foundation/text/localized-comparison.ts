import type { FoundationHost } from "../../objc/host";
export function installLocalizedComparisons(
  host: Pick<FoundationHost, "method" | "text">,
  locale: string | undefined,
): void {
  const caseSensitive = new Intl.Collator(locale, { sensitivity: "variant" });
  const caseInsensitive = new Intl.Collator(locale, { sensitivity: "accent" });
  for (const [selector, collator] of [
    ["localizedCompare:", caseSensitive],
    ["localizedCaseInsensitiveCompare:", caseInsensitive],
  ] as const)
    host.method("NSString", false, selector, (self, args) =>
      Math.sign(collator.compare(host.text(self), host.text(args(0)))),
    );
}
