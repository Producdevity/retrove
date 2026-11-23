import type { FoundationObjects } from "./late-bindings";
import { WORD_BYTES } from "../abi/scalars";
import { installCStringConstructors } from "../foundation/c-strings";
import { DataField } from "../foundation/data";
import { installStringBytes } from "../foundation/text/byte-constructors";
import { installStringCharacters } from "../foundation/text/characters";
import { decodeText } from "../foundation/text/encoding";
import { installMutableStringEdits } from "../foundation/text/mutable-string";
import { installPercentEscapes } from "../foundation/text/percent-escape-host";
import { installStringReplacement } from "../foundation/text/replacement-host";
import type { ClassRegistry } from "./class-registry";
import type { GuestAccess } from "./guest-access";
import type { ObjectOwnership } from "./object-ownership";
import { installUnobservedPropertyChanges } from "./properties";
import type { ObjcHeap } from "./runtime-types";
import type { StringObjects } from "./string-objects";

const STRING = "NSString";
const MUTABLE_STRING = "NSMutableString";
export interface StringMethodHost {
  readonly memory: GuestAccess;
  readonly heap: ObjcHeap;
  readonly registry: ClassRegistry;
  readonly ownership: ObjectOwnership;
  readonly strings: StringObjects;
  readonly foundation: () => FoundationObjects;
}
/** NSString and NSMutableString storage methods, in the order later installers override them. */
export function installStringMethods(host: StringMethodHost): void {
  const { memory, registry, ownership, strings } = host;
  const { method } = registry;
  const { text, makeString } = strings;
  installUnobservedPropertyChanges({
    method,
    text,
    changed: (self) => host.foundation().operationsChanged(self),
  });
  method(STRING, false, "initWithData:encoding:", (self, args) => {
    const data = args(0),
      value = data
        ? decodeText(
            memory.bytes(memory.read(data + DataField.Bytes), memory.read(data + DataField.Length)),
            args(1),
          )
        : null;
    if (value === null) {
      ownership.destroy(self);
      return 0;
    }
    return makeString(value, self);
  });
  installStringBytes({
    method,
    destroy: ownership.destroy,
    readBytes: memory.bytes,
    freeBytes: (pointer) => host.heap.free(pointer),
    initialize: (pointer, value) => makeString(value, pointer),
  });
  installFormattedStrings(host);
  installMutableStringEdits({
    method,
    text,
    assign: (self, value) => {
      makeString(value, self);
    },
  });
  method(STRING, false, "mutableCopy", (self) =>
    makeString(text(self), ownership.alloc(registry.names.get(MUTABLE_STRING) ?? 0)),
  );
  installPercentEscapes({ method, text, string: strings.string });
  installStringReplacement({
    method,
    text,
    string: strings.string,
    assign: (pointer, value) => {
      makeString(value, pointer);
    },
  });
  installStringCharacters({
    method,
    text,
    alloc: ownership.alloc,
    autorelease: ownership.autorelease,
    readBytes: memory.bytes,
    writeBytes: memory.writeBytes,
    initialize: (pointer, bytes) => strings.makeUTF16(bytes, pointer),
  });
  installCStringConstructors({
    method,
    alloc: ownership.alloc,
    autorelease: ownership.autorelease,
    destroy: ownership.destroy,
    bytes: memory.cStringBytes,
    decode: decodeText,
    initialize: (pointer, value) => makeString(value, pointer),
    utf8: strings.utf8,
  });
  installStringQueries(host);
}
function installFormattedStrings({
  memory,
  registry,
  ownership,
  strings,
  foundation,
}: StringMethodHost): void {
  const { method } = registry;
  const { text, makeString } = strings;
  method(STRING, false, "initWithFormat:", (self, args) =>
    makeString(
      foundation().formatted(args(0), (index) => args(index + 1)),
      self,
    ),
  );
  method(STRING, false, "initWithFormat:arguments:", (self, args) => {
    const list = args(1);
    return makeString(
      foundation().formatted(args(0), (index) => memory.read(list + index * WORD_BYTES)),
      self,
    );
  });
  method(STRING, false, "initWithString:", (self, args) => makeString(text(args(0)), self));
  method(STRING, true, "stringWithString:", (cls, args) =>
    ownership.autorelease(makeString(text(args(0)), ownership.alloc(cls))),
  );
  method(MUTABLE_STRING, true, "stringWithCapacity:", (cls) =>
    ownership.autorelease(makeString("", ownership.alloc(cls))),
  );
  method(MUTABLE_STRING, false, "initWithCapacity:", (self) => makeString("", self));
  method(MUTABLE_STRING, false, "setString:", (self, args) => {
    makeString(text(args(0)), self);
  });
  method(MUTABLE_STRING, false, "appendString:", (self, args) => {
    makeString(text(self) + text(args(0)), self);
  });
  method(MUTABLE_STRING, false, "appendFormat:", (self, args) => {
    makeString(text(self) + foundation().formatted(args(0), (index) => args(index + 1)), self);
  });
  method(MUTABLE_STRING, false, "copy", (self) => makeString(text(self)));
}
function installStringQueries({ memory, registry, ownership, strings }: StringMethodHost): void {
  const { method } = registry;
  const { text, string } = strings;
  method(STRING, false, "length", (self) => text(self).length);
  method(STRING, false, "UTF8String", strings.utf8);
  method(STRING, false, "fileSystemRepresentation", strings.utf8);
  method(STRING, false, "description", (self) => self);
  method(STRING, false, "copy", ownership.retain);
  method(STRING, false, "copyWithZone:", ownership.retain);
  method(STRING, false, "isEqualToString:", (self, args) =>
    Number(!!args(0) && text(self) === text(args(0))),
  );
  method(STRING, false, "isEqual:", (self, args) =>
    Number(
      !!args(0) &&
        registry.subclass(memory.read(args(0)), registry.names.get(STRING) ?? 0) &&
        text(self) === text(args(0)),
    ),
  );
  method(STRING, false, "stringByAppendingString:", (self, args) =>
    string(text(self) + text(args(0))),
  );
  method(STRING, false, "stringByAppendingPathComponent:", (self, args) => {
    const base = text(self).replace(/\/+$/, ""),
      item = text(args(0)).replace(/^\/+/, "");
    return string(`${base}/${item}`);
  });
  method(STRING, false, "hasPrefix:", (self, args) => Number(text(self).startsWith(text(args(0)))));
  method(STRING, false, "hasSuffix:", (self, args) => Number(text(self).endsWith(text(args(0)))));
}
