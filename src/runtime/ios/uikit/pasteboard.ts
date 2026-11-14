import { GuestStorageKey } from "../../../storage/guest-keys";
import { isRecord } from "../../../domain/validation";
import type { FoundationHost } from "../objc/host";
const CLASS = "UIPasteboard";
const PREFIX = GuestStorageKey.Pasteboard;
const GENERAL = "com.apple.UIKit.pboard.general";
const TEXT_TYPE = "public.utf8-plain-text";
const TYPE_SUFFIX = ".types";
const BYTE_MAX = 255;
type Payload = string | Uint8Array;
interface Board {
  readonly name: string;
  readonly key: string;
  readonly values: Map<string, Payload>;
  persistent: boolean;
  changes: number;
}
interface PasteboardHost extends FoundationHost {
  readonly identifier: string;
  read(key: string): string | null;
  save(key: string, value: string | null): void;
  bytes(pointer: number): Uint8Array;
  isKind(pointer: number, name: string): boolean;
  property(value: unknown): number;
  items(pointer: number): number[];
  unique(): string;
}
function restored(raw: string | null): Map<string, Payload> {
  if (raw === null) return new Map();
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error("Invalid pasteboard contents.");
  return new Map(
    Object.entries(parsed).map(([type, value]): [string, Payload] => {
      if (typeof value === "string") return [type, value];
      if (!Array.isArray(value)) throw new Error("Invalid pasteboard data.");
      const bytes: readonly unknown[] = value;
      if (
        !bytes.every(
          (value) =>
            typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= BYTE_MAX,
        )
      )
        throw new Error("Invalid pasteboard byte.");
      return [
        type,
        Uint8Array.from(
          bytes.map((value) => {
            if (typeof value !== "number") throw new Error("Invalid pasteboard byte.");
            return value;
          }),
        ),
      ];
    }),
  );
}
export function installPasteboards(host: PasteboardHost): void {
  const klass = host.hostClass(CLASS, "NSObject"),
    byName = new Map<string, number>(),
    boards = new Map<number, Board>();
  const get = (self: number) => {
    const board = boards.get(self);
    if (!board) throw new Error("Unknown guest pasteboard.");
    return board;
  };
  const persist = (board: Board) => {
    const value = board.values.get(TEXT_TYPE);
    host.save(board.key, board.persistent && typeof value === "string" ? value : null);
    host.save(
      board.key + TYPE_SUFFIX,
      board.persistent
        ? JSON.stringify(
            Object.fromEntries(
              [...board.values].map(([key, value]) => [
                key,
                value instanceof Uint8Array ? Array.from(value) : value,
              ]),
            ),
          )
        : null,
    );
  };
  const open = (name: string, create: boolean): number => {
    const existing = byName.get(name);
    if (existing) return existing;
    const key = PREFIX + host.identifier + "." + name,
      legacy = host.read(key),
      typed = host.read(key + TYPE_SUFFIX);
    if (!create && legacy === null && typed === null) return 0;
    const values = restored(typed);
    if (legacy !== null && !values.has(TEXT_TYPE)) values.set(TEXT_TYPE, legacy);
    const pointer = host.alloc(klass);
    byName.set(name, pointer);
    boards.set(pointer, {
      name,
      key,
      values,
      persistent: name === GENERAL || legacy !== null || typed !== null,
      changes: 0,
    });
    return pointer;
  };
  host.method(CLASS, true, "generalPasteboard", () => open(GENERAL, true));
  host.method(CLASS, true, "pasteboardWithUniqueName", () => open(host.unique(), true));
  host.method(CLASS, true, "pasteboardWithName:create:", (_, args) =>
    args(0) ? open(host.text(args(0)), Boolean(args(1))) : 0,
  );
  host.method(CLASS, false, "name", (self) => host.string(get(self).name));
  host.method(CLASS, false, "isPersistent", (self) => Number(get(self).persistent));
  host.method(CLASS, false, "setPersistent:", (self, args) => {
    const board = get(self);
    board.persistent = Boolean(args(0));
    persist(board);
  });
  host.method(CLASS, false, "changeCount", (self) => get(self).changes);
  host.method(CLASS, false, "numberOfItems", (self) => Number(get(self).values.size > 0));
  host.method(CLASS, false, "pasteboardTypes", (self) =>
    host.property([...get(self).values.keys()]),
  );
  host.method(CLASS, false, "containsPasteboardTypes:", (self, args) =>
    Number(host.items(args(0)).some((type) => get(self).values.has(host.text(type)))),
  );
  installValues(host, get, persist);
  host.method(CLASS, false, "dealloc", (self) => {
    const board = get(self);
    boards.delete(self);
    byName.delete(board.name);
    host.destroy(self);
  });
}
function installValues(
  host: PasteboardHost,
  get: (self: number) => Board,
  persist: (board: Board) => void,
): void {
  const changed = (board: Board) => {
    board.changes++;
    persist(board);
  };
  host.method(CLASS, false, "string", (self) => {
    const value = get(self).values.get(TEXT_TYPE);
    return value === undefined
      ? 0
      : host.string(typeof value === "string" ? value : new TextDecoder().decode(value));
  });
  host.method(CLASS, false, "setString:", (self, args) => {
    const board = get(self);
    board.values.clear();
    if (args(0)) board.values.set(TEXT_TYPE, host.text(args(0)));
    changed(board);
  });
  host.method(CLASS, false, "valueForPasteboardType:", (self, args) =>
    host.property(get(self).values.get(host.text(args(0)))),
  );
  host.method(CLASS, false, "dataForPasteboardType:", (self, args) => {
    const value = get(self).values.get(host.text(args(0)));
    return value === undefined
      ? 0
      : host.property(typeof value === "string" ? new TextEncoder().encode(value) : value);
  });
  for (const selector of ["setValue:forPasteboardType:", "setData:forPasteboardType:"])
    host.method(CLASS, false, selector, (self, args) => {
      const pointer = args(0),
        type = host.text(args(1)),
        board = get(self);
      if (!type) throw new Error("Pasteboard type is empty.");
      if (!pointer) board.values.delete(type);
      else if (host.isKind(pointer, "NSData")) board.values.set(type, host.bytes(pointer).slice());
      else if (selector === "setValue:forPasteboardType:" && host.isKind(pointer, "NSString"))
        board.values.set(type, host.text(pointer));
      else throw new Error("Unsupported guest pasteboard value.");
      changed(board);
    });
}
