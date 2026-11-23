import { DataField } from "../foundation/data";
import { identifierForTag, preferredTag } from "../services/uniform-types";
import type { ObjcCore } from "./core";
import type { FoundationFrameworks } from "./foundation-frameworks";
import { Argument, type GuestArguments } from "./host";
import type { GuestFunctions } from "./runtime-functions";

const LOG_LIMIT = 512;
const UNOWNED_RETAIN_COUNT = 0xffffffff;
const USER_DOMAIN_MASK = 1;
/** NSSearchPathDirectory values and the sandbox directory each names. */
const SearchPathDirectory = {
  Library: 5,
  Documents: 9,
  Caches: 13,
  ApplicationSupport: 14,
} as const;
const DIRECTORIES = new Map<number, string>([
  [SearchPathDirectory.Library, "Library"],
  [SearchPathDirectory.Documents, "Documents"],
  [SearchPathDirectory.Caches, "Library/Caches"],
  [SearchPathDirectory.ApplicationSupport, "Library/Application Support"],
]);
/** NSLog and the CoreFoundation, path and UTType functions apps call directly. */
export function foundationFunctions(
  core: ObjcCore,
  frameworks: FoundationFrameworks,
): GuestFunctions {
  const { memory, ownership, strings, data, options } = core;
  const { foundation: objects, input } = frameworks;
  const { text, string } = strings;
  const both = (a: GuestArguments) => !!a(Argument.First) && !!a(Argument.Second);
  return {
    _NSLog: (a: GuestArguments) => {
      const message = objects.formatted(a(Argument.First), (index) => a(index + 1));
      options.diagnostic("debug", "guest-output", message.slice(0, LOG_LIMIT));
    },
    _CFRetain: (a: GuestArguments) => ownership.retain(a(Argument.First)),
    _CFRelease: (a: GuestArguments) => ownership.release(a(Argument.First)),
    _CFEqual: (a: GuestArguments) => frameworks.equalObjects(a(Argument.First), a(Argument.Second)),
    _CFHash: (a: GuestArguments) => frameworks.hashObject(a(Argument.First)),
    _CFGetRetainCount: (a: GuestArguments) =>
      ownership.coreGraphics?.retainCount(a(Argument.First)) ??
      ownership.owned.get(a(Argument.First))?.count ??
      UNOWNED_RETAIN_COUNT,
    _CFDataCreate: (a: GuestArguments) => {
      if (a(Argument.First)) throw new Error("CFDataCreate with a custom allocator is unsupported");
      return data.createData(a(Argument.Second), a(Argument.Third));
    },
    _CFDataGetLength: (a: GuestArguments) => memory.read(a(Argument.First) + DataField.Length),
    _CFDataGetBytePtr: (a: GuestArguments) => memory.read(a(Argument.First) + DataField.Bytes),
    _NSSearchPathForDirectoriesInDomains: (a: GuestArguments) => {
      const directory = DIRECTORIES.get(a(Argument.First));
      const paths =
        a(Argument.Second) & USER_DOMAIN_MASK && directory
          ? [string((a(Argument.Third) ? "/" : "~/") + directory)]
          : [];
      return ownership.autorelease(input.array(paths));
    },
    _UTTypeCreatePreferredIdentifierForTag: (a: GuestArguments) =>
      both(a)
        ? ownership.retain(
            string(identifierForTag(text(a(Argument.First)), text(a(Argument.Second)))),
          )
        : 0,
    _UTTypeCopyPreferredTagWithClass: (a: GuestArguments) => {
      const tag = both(a)
        ? preferredTag(text(a(Argument.First)), text(a(Argument.Second)))
        : undefined;
      return tag === undefined ? 0 : ownership.retain(string(tag));
    },
    _NSHomeDirectory: () => string("/"),
    _NSTemporaryDirectory: () => string("/tmp/"),
  };
}
