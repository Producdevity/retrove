import { Argument, FoundationClass, type FoundationHost } from "../objc/host";
import { CharacterSet } from "./character-set";
import { installCharacterSets, type CharacterSets } from "./character-set-host";
import { TextScanner } from "./text-scanner";

interface ScannerState {
  readonly scanner: TextScanner;
  readonly source: number;
  skipped: number;
}
class ScannerObjects {
  private readonly states = new Map<number, ScannerState>();
  constructor(
    private readonly host: FoundationHost,
    private readonly characters: CharacterSets,
  ) {}
  get(self: number): ScannerState {
    const state = this.states.get(self);
    if (!state) throw new Error("NSScanner has not been initialized.");
    return state;
  }
  async initialize(self: number, source: number): Promise<number> {
    const scanner = new TextScanner(this.host.text(source));
    this.host.retain(source);
    const previous = this.states.get(self);
    if (previous) {
      await this.host.release(previous.source);
      await this.host.release(previous.skipped);
    }
    const skipped = this.characters.create(CharacterSet.whitespaceAndNewline());
    this.states.set(self, { scanner, source, skipped });
    return self;
  }
  async setSkipped(self: number, pointer: number): Promise<void> {
    const state = this.get(self);
    const set = this.characters.get(pointer);
    const copied = pointer ? this.characters.create(set) : 0;
    const previous = state.skipped;
    state.skipped = copied;
    state.scanner.skipped = set;
    await this.host.release(previous);
  }
  async destroy(self: number): Promise<void> {
    const state = this.states.get(self);
    this.states.delete(self);
    if (state) {
      await this.host.release(state.source);
      await this.host.release(state.skipped);
    }
    this.host.destroy(self);
  }
}

function installScanMethods(
  host: FoundationHost,
  objects: ScannerObjects,
  sets: CharacterSets,
): void {
  const stringResult = (value: string | null, destination: number): number => {
    if (value === null) return 0;
    if (destination) host.write(destination, host.string(value));
    return 1;
  };
  host.method(FoundationClass.Scanner, false, "scanInt:", (self, args) => {
    const value = objects.get(self).scanner.integer();
    if (value === null) return 0;
    const destination = args(Argument.First);
    if (destination) host.write(destination, value >>> 0);
    return 1;
  });
  host.method(FoundationClass.Scanner, false, "scanHexInt:", (self, args) => {
    const value = objects.get(self).scanner.hexInteger();
    if (value === null) return 0;
    if (args(Argument.First)) host.write(args(Argument.First), value);
    return 1;
  });
  host.method(FoundationClass.Scanner, false, "scanCharactersFromSet:intoString:", (self, args) =>
    stringResult(
      objects.get(self).scanner.characters(sets.get(args(Argument.First))),
      args(Argument.Second),
    ),
  );
  host.method(
    FoundationClass.Scanner,
    false,
    "scanUpToCharactersFromSet:intoString:",
    (self, args) =>
      stringResult(
        objects.get(self).scanner.characters(sets.get(args(Argument.First)), true),
        args(Argument.Second),
      ),
  );
  host.method(FoundationClass.Scanner, false, "scanString:intoString:", (self, args) =>
    stringResult(
      objects.get(self).scanner.string(host.text(args(Argument.First))),
      args(Argument.Second),
    ),
  );
  host.method(FoundationClass.Scanner, false, "scanUpToString:intoString:", (self, args) =>
    stringResult(
      objects.get(self).scanner.upToString(host.text(args(Argument.First))),
      args(Argument.Second),
    ),
  );
}

export function installScanners(host: FoundationHost): CharacterSets {
  const sets = installCharacterSets(host);
  const objects = new ScannerObjects(host, sets);
  const classPointer = host.hostClass(FoundationClass.Scanner, FoundationClass.Object);
  host.method(FoundationClass.Scanner, true, "scannerWithString:", async (_self, args) =>
    host.autorelease(await objects.initialize(host.alloc(classPointer), args(Argument.First))),
  );
  host.method(FoundationClass.Scanner, false, "initWithString:", (self, args) =>
    objects.initialize(self, args(Argument.First)),
  );
  host.method(FoundationClass.Scanner, false, "string", (self) => objects.get(self).source);
  host.method(
    FoundationClass.Scanner,
    false,
    "scanLocation",
    (self) => objects.get(self).scanner.location,
  );
  host.method(FoundationClass.Scanner, false, "setScanLocation:", (self, args) => {
    objects.get(self).scanner.location = args(Argument.First);
  });
  host.method(FoundationClass.Scanner, false, "isAtEnd", (self) =>
    Number(objects.get(self).scanner.atEnd),
  );
  host.method(FoundationClass.Scanner, false, "caseSensitive", (self) =>
    Number(objects.get(self).scanner.caseSensitive),
  );
  host.method(FoundationClass.Scanner, false, "setCaseSensitive:", (self, args) => {
    objects.get(self).scanner.caseSensitive = Boolean(args(Argument.First));
  });
  host.method(
    FoundationClass.Scanner,
    false,
    "charactersToBeSkipped",
    (self) => objects.get(self).skipped,
  );
  host.method(FoundationClass.Scanner, false, "setCharactersToBeSkipped:", (self, args) =>
    objects.setSkipped(self, args(Argument.First)),
  );
  host.method(FoundationClass.Scanner, false, "dealloc", (self) => objects.destroy(self));
  installScanMethods(host, objects, sets);
  return sets;
}
