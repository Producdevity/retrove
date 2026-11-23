import { replacePercentEscapes } from "../string-encodings";
import { encoded } from "./encoding";
import { Argument, type CoreFoundationFunction, type CoreFoundationHost } from "./types";

const HEX = 16;
const BYTE_DIGITS = 2;
const UNESCAPED = /^[A-Za-z0-9;/?:@&=+$,_.!~*'()#-]$/u;

export function percentFunctions(host: CoreFoundationHost): Record<string, CoreFoundationFunction> {
  const { text, makeString } = host;
  const optionalText = (pointer: number): string | undefined =>
    pointer ? text(pointer) : undefined;
  function addPercentEscapes(a: (index: number) => number): number {
    if (a(0) || !a(1)) return 0;
    const leave = optionalText(a(Argument.Third)) ?? "",
      escape = optionalText(a(Argument.Fourth)) ?? "",
      encoding = a(Argument.Fifth);
    let result = "";
    for (const character of text(a(1))) {
      if (leave.includes(character) || (!escape.includes(character) && UNESCAPED.test(character))) {
        result += character;
        continue;
      }
      const bytes = encoded(character, encoding);
      if (!bytes) return 0;
      for (const value of bytes)
        result += `%${value.toString(HEX).padStart(BYTE_DIGITS, "0").toUpperCase()}`;
    }
    return makeString(result);
  }
  const removePercentEscapes =
    (withEncoding: boolean): CoreFoundationFunction =>
    (a) => {
      if (a(0) || !a(1)) return 0;
      const leave = optionalText(a(Argument.Third));
      const value = withEncoding
        ? replacePercentEscapes(text(a(1)), leave, a(Argument.Fourth))
        : replacePercentEscapes(text(a(1)), leave);
      return value === undefined ? 0 : makeString(value);
    };
  return {
    _CFURLCreateStringByAddingPercentEscapes: addPercentEscapes,
    _CFURLCreateStringByReplacingPercentEscapesUsingEncoding: removePercentEscapes(true),
    _CFURLCreateStringByReplacingPercentEscapes: removePercentEscapes(false),
  };
}
