import type { FoundationHost } from "../../objc/host";
const SIGNED_LONG_LONG = {
  Minimum: -0x8000_0000_0000_0000n,
  Maximum: 0x7fff_ffff_ffff_ffffn,
} as const;
export function stringLongLong(value: string): bigint {
  const match = /^[\t\n\v\f\r ]*([+-]?\d+)/.exec(value),
    digits = match?.[1];
  if (!digits) return BigInt(0);
  const result = BigInt(digits);
  return result < SIGNED_LONG_LONG.Minimum
    ? SIGNED_LONG_LONG.Minimum
    : result > SIGNED_LONG_LONG.Maximum
      ? SIGNED_LONG_LONG.Maximum
      : result;
}
export function installStringLongLong(host: Pick<FoundationHost, "method" | "text">): void {
  host.method("NSString", false, "longLongValue", (self) => stringLongLong(host.text(self)));
}
