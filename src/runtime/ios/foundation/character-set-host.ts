import { Argument, FoundationClass, type FoundationHost } from "../objc/host";
import { CharacterSet, UNICODE_CHARACTER_LIMIT } from "./character-set";
const MUTABLE_CHARACTER_SET = "NSMutableCharacterSet";
export interface CharacterSets {
  get(pointer: number): CharacterSet;
  create(set: CharacterSet): number;
}
class CharacterSetObjects implements CharacterSets {
  private readonly sets = new Map<number, CharacterSet>();
  readonly base: number;
  readonly mutable: number;
  constructor(private readonly host: FoundationHost) {
    this.base = host.hostClass(FoundationClass.CharacterSet, FoundationClass.Object);
    this.mutable = host.hostClass(MUTABLE_CHARACTER_SET, FoundationClass.CharacterSet);
  }
  create(set: CharacterSet, cls = this.base): number {
    const pointer = this.host.alloc(cls);
    this.sets.set(pointer, set);
    return pointer;
  }
  get(pointer: number): CharacterSet {
    if (!pointer) return CharacterSet.empty();
    const set = this.sets.get(pointer);
    if (!set) throw new Error("Expected an NSCharacterSet.");
    return set;
  }
  replace(pointer: number, set: CharacterSet): void {
    this.sets.set(pointer, set);
  }
  destroy(pointer: number): void {
    this.sets.delete(pointer);
    this.host.destroy(pointer);
  }
}
function installFactories(host: FoundationHost, objects: CharacterSetObjects): void {
  for (const [selector, make] of [
    ["decimalDigitCharacterSet", () => CharacterSet.decimal()],
    ["whitespaceCharacterSet", () => CharacterSet.whitespace()],
    ["whitespaceAndNewlineCharacterSet", () => CharacterSet.whitespaceAndNewline()],
  ] as const)
    host.method(FoundationClass.CharacterSet, true, selector, (self) =>
      host.autorelease(objects.create(make(), self)),
    );
  host.method(
    FoundationClass.CharacterSet,
    true,
    "characterSetWithCharactersInString:",
    (self, args) =>
      host.autorelease(objects.create(CharacterSet.characters(host.text(args(0))), self)),
  );
  host.method(FoundationClass.CharacterSet, true, "characterSetWithRange:", (self, args) =>
    host.autorelease(objects.create(CharacterSet.range(args(0), args(1)), self)),
  );
}
function installMutableMethods(host: FoundationHost, objects: CharacterSetObjects): void {
  for (const remove of [false, true]) {
    host.method(
      MUTABLE_CHARACTER_SET,
      false,
      (remove ? "remove" : "add") + "CharactersInString:",
      (self, args) => {
        const next = CharacterSet.characters(host.text(args(0))),
          previous = objects.get(self);
        objects.replace(self, remove ? previous.subtract(next) : previous.union(next));
      },
    );
    host.method(
      MUTABLE_CHARACTER_SET,
      false,
      (remove ? "remove" : "add") + "CharactersInRange:",
      (self, args) => {
        const next = CharacterSet.range(args(0), args(1)),
          previous = objects.get(self);
        objects.replace(self, remove ? previous.subtract(next) : previous.union(next));
      },
    );
  }
  for (const [selector, combine] of [
    ["formUnionWithCharacterSet:", (a: CharacterSet, b: CharacterSet) => a.union(b)],
    ["formIntersectionWithCharacterSet:", (a: CharacterSet, b: CharacterSet) => a.intersection(b)],
  ] as const)
    host.method(MUTABLE_CHARACTER_SET, false, selector, (self, args) =>
      objects.replace(self, combine(objects.get(self), objects.get(args(0)))),
    );
  host.method(MUTABLE_CHARACTER_SET, false, "invert", (self) =>
    objects.replace(self, objects.get(self).inverted()),
  );
  host.method(MUTABLE_CHARACTER_SET, false, "copy", (self) => objects.create(objects.get(self)));
}
export function installCharacterSets(host: FoundationHost): CharacterSets {
  const objects = new CharacterSetObjects(host);
  installFactories(host, objects);
  installMutableMethods(host, objects);
  host.method(FoundationClass.CharacterSet, false, "init", (self) => {
    objects.replace(self, CharacterSet.empty());
    return self;
  });
  host.method(FoundationClass.CharacterSet, false, "characterIsMember:", (self, args) =>
    Number(objects.get(self).contains(String.fromCharCode(args(Argument.First)))),
  );
  host.method(FoundationClass.CharacterSet, false, "longCharacterIsMember:", (self, args) => {
    const code = args(0);
    return Number(
      code < UNICODE_CHARACTER_LIMIT && objects.get(self).contains(String.fromCodePoint(code)),
    );
  });
  host.method(FoundationClass.CharacterSet, false, "invertedSet", (self) =>
    host.autorelease(objects.create(objects.get(self).inverted())),
  );
  host.method(FoundationClass.CharacterSet, false, "copy", (self) => host.retain(self));
  host.method(FoundationClass.CharacterSet, false, "mutableCopy", (self) =>
    objects.create(objects.get(self), objects.mutable),
  );
  host.method(FoundationClass.CharacterSet, false, "dealloc", (self) => objects.destroy(self));
  return { create: (set) => objects.create(set), get: (pointer) => objects.get(pointer) };
}
