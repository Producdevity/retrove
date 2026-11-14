import type { FoundationHost } from "../../objc/host";
import { replaceOccurrences, replaceRange } from "./replacement";
const STRING = "NSString",
  MUTABLE_STRING = "NSMutableString";
const ReplacementArgument = {
  Target: 0,
  Replacement: 1,
  Options: 2,
  Location: 3,
  Length: 4,
} as const;
interface ReplacementHost extends Pick<FoundationHost, "method" | "text" | "string"> {
  assign(pointer: number, value: string): void;
}
export function installStringReplacement(host: ReplacementHost): void {
  const text = (pointer: number): string => {
    if (!pointer) throw new Error("NSString replacement requires non-nil strings.");
    return host.text(pointer);
  };
  for (const mutable of [false, true]) {
    const selector =
      (mutable ? "replace" : "stringByReplacing") + "OccurrencesOfString:withString:options:range:";
    host.method(mutable ? MUTABLE_STRING : STRING, false, selector, (self, args) => {
      const result = replaceOccurrences(
        host.text(self),
        text(args(ReplacementArgument.Target)),
        text(args(ReplacementArgument.Replacement)),
        args(ReplacementArgument.Options),
        args(ReplacementArgument.Location),
        args(ReplacementArgument.Length),
      );
      if (!mutable) return host.string(result.value);
      if (result.count) host.assign(self, result.value);
      return result.count;
    });
    const rangeSelector =
      (mutable ? "replace" : "stringByReplacing") + "CharactersInRange:withString:";
    host.method(mutable ? MUTABLE_STRING : STRING, false, rangeSelector, (self, args) => {
      const value = replaceRange(
        host.text(self),
        text(args(ReplacementArgument.Options)),
        args(ReplacementArgument.Target),
        args(ReplacementArgument.Replacement),
      );
      if (!mutable) return host.string(value);
      return host.assign(self, value);
    });
  }
  host.method(STRING, false, "stringByReplacingOccurrencesOfString:withString:", (self, args) => {
    const value = host.text(self);
    return host.string(
      replaceOccurrences(value, text(args(0)), text(args(1)), 0, 0, value.length).value,
    );
  });
}
