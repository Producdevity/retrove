import { installStringLongLong } from "../text/integer-value";
import { DECIMAL_RADIX } from "./constants";
import { installStringSearch } from "./install-string-search";
import type { FoundationContext } from "./types";

const STRING = "NSString";
const BOOLEAN_TEXT = /^[yYtT1-9]/;
const TRAILING_SLASHES = /\/+$/;

export function installStrings(ctx: FoundationContext): void {
  const { method, h, string, text, autorelease } = ctx;
  method(STRING, true, "stringWithFormat:", (_, args) =>
    string(h.formatted(args(0), (index) => args(index + 1))),
  );
  method(STRING, false, "stringByAppendingFormat:", (self, args) =>
    string(text(self) + h.formatted(args(0), (index) => args(index + 1))),
  );
  method(STRING, false, "lastPathComponent", (self) =>
    string(text(self).split("/").filter(Boolean).at(-1) ?? "/"),
  );
  method(STRING, false, "stringByDeletingLastPathComponent", (self) => {
    const path = text(self).replace(TRAILING_SLASHES, "");
    const at = path.lastIndexOf("/");
    if (at === 0) return string("/");
    return string(at < 0 ? "" : path.slice(0, at));
  });
  method(STRING, false, "componentsSeparatedByString:", (self, args) =>
    autorelease(
      ctx.array(
        text(self)
          .split(text(args(0)))
          .map((part) => string(part)),
      ),
    ),
  );
  installStringLongLong({ method, text });
  installNumericConversions(ctx);
  installStringSearch(ctx);
}

function installNumericConversions(ctx: FoundationContext): void {
  const { method, h, text } = ctx;
  const conversions: [string, (value: string) => number | bigint][] = [
    ["intValue", (value) => parseInt(value, DECIMAL_RADIX) | 0],
    ["integerValue", (value) => parseInt(value, DECIMAL_RADIX) | 0],
    ["boolValue", (value) => Number(BOOLEAN_TEXT.test(value.trim()))],
    [
      "floatValue",
      (value) => {
        h.bits.setFloat32(0, parseFloat(value) || 0, true);
        return h.bits.getUint32(0, true);
      },
    ],
    [
      "doubleValue",
      (value) => {
        h.bits.setFloat64(0, parseFloat(value) || 0, true);
        return h.bits.getBigUint64(0, true);
      },
    ],
  ];
  for (const [name, convert] of conversions) {
    method(STRING, false, name, (self) => convert(text(self)));
  }
}
