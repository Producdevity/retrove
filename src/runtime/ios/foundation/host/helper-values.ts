import { formatDarwin } from "../../libc/format";
import { REFERENCE_DATE_UNIX_SECONDS } from "../dates";
import { propertyValue } from "../property-lists";
import { DataField, DEFAULT_LANGUAGE, HEX_RADIX, MILLISECONDS_PER_SECOND } from "./constants";
import type { FoundationBase, Helpers } from "./types";

type ValueHelpers = Pick<
  Helpers,
  | "number"
  | "numberText"
  | "date"
  | "property"
  | "unbox"
  | "plist"
  | "description"
  | "formatted"
  | "languages"
  | "primaryLanguage"
>;
type Core = Pick<Helpers, "classPointer" | "dictionary" | "entries">;

export function createValues(base: FoundationBase, core: Core): ValueHelpers {
  const { state, late, isKind, text, items, cpu, read, utf8 } = base;
  const number: Helpers["number"] = (value) => {
    const pointer = base.alloc(core.classPointer("NSNumber"));
    state.numbers.set(pointer, value);
    return base.autorelease(pointer);
  };
  const numberText: Helpers["numberText"] = (pointer) => {
    const value = state.numbers.get(pointer);
    return (
      late.decimals.get().text(pointer) ??
      String(typeof value === "boolean" ? Number(value) : value)
    );
  };
  const date: Helpers["date"] = (seconds) => late.dates.get().create(seconds);
  const languages = (): string[] => [...(globalThis.navigator?.languages ?? [DEFAULT_LANGUAGE])];
  const primaryLanguage = (): string => languages()[0] ?? DEFAULT_LANGUAGE;
  const unbox: Helpers["unbox"] = (pointer) => {
    if (!pointer || isKind(pointer, "NSNull")) return null;
    if (isKind(pointer, "NSString")) return text(pointer);
    const value = state.numbers.get(pointer);
    if (state.numbers.has(pointer)) return typeof value === "bigint" ? Number(value) : value;
    if (isKind(pointer, "NSArray")) return items(pointer).map(unbox);
    if (isKind(pointer, "NSDictionary")) {
      return Object.fromEntries(
        core.entries(pointer).map(([key, item]) => [text(key), unbox(item)]),
      );
    }
    throw new Error("Expected a Foundation property-list value");
  };
  const plist: Helpers["plist"] = (pointer) => {
    if (pointer && isKind(pointer, "NSData")) {
      return cpu.read(read(pointer + DataField.Bytes), read(pointer + DataField.Length));
    }
    if (pointer && isKind(pointer, "NSDate")) {
      const seconds = late.dates.get().referenceTime(pointer) + REFERENCE_DATE_UNIX_SECONDS;
      return new Date(seconds * MILLISECONDS_PER_SECOND);
    }
    if (pointer && isKind(pointer, "NSArray")) return items(pointer).map(plist);
    if (pointer && isKind(pointer, "NSDictionary")) {
      return Object.fromEntries(
        core.entries(pointer).map(([key, item]) => [text(key), plist(item)]),
      );
    }
    return unbox(pointer);
  };
  const description: Helpers["description"] = (pointer) => {
    if (state.numbers.has(pointer)) return numberText(pointer);
    if (isKind(pointer, "NSString")) return text(pointer);
    if (isKind(pointer, "NSURL")) return state.urls.get(pointer)?.href ?? "";
    if (isKind(pointer, "NSDictionary") || isKind(pointer, "NSArray")) {
      return JSON.stringify(unbox(pointer));
    }
    return `<NSObject: 0x${pointer.toString(HEX_RADIX)}>`;
  };
  const formatted: Helpers["formatted"] = (template, word) => {
    const bytes = formatDarwin(cpu, utf8(template), word, description);
    return new TextDecoder().decode(Uint8Array.from(bytes, (char) => char.charCodeAt(0)));
  };
  const property = createProperty(base, core, number, date);
  return {
    number,
    numberText,
    date,
    property,
    unbox,
    plist,
    description,
    formatted,
    languages,
    primaryLanguage,
  };
}

function createProperty(
  base: FoundationBase,
  core: Core,
  number: Helpers["number"],
  date: Helpers["date"],
): Helpers["property"] {
  const { alloc, autorelease, makeString, string, heap, cpu, dataFrom, array } = base;
  return (value, mutability = 0) =>
    propertyValue(
      {
        string: (text, mutable) =>
          mutable
            ? autorelease(makeString(text, alloc(core.classPointer("NSMutableString"))))
            : string(text),
        number,
        date,
        array,
        autorelease,
        dictionary: (pairs, mutable) =>
          core.dictionary(
            core.classPointer(mutable ? "NSMutableDictionary" : "NSDictionary"),
            pairs,
          ),
        data: (bytes, mutable) => {
          const pointer = heap.alloc(Math.max(1, bytes.length));
          try {
            cpu.write(pointer, bytes);
            const target = mutable ? alloc(core.classPointer("NSMutableData")) : undefined;
            return autorelease(dataFrom(pointer, bytes.length, target));
          } finally {
            heap.free(pointer);
          }
        },
      },
      value,
      mutability,
    );
}
