import type { FoundationBase, Helpers } from "./types";

type CoreHelpers = Pick<
  Helpers,
  "classPointer" | "singleton" | "associated" | "get" | "dictionary" | "entries"
>;

export function createCore(base: FoundationBase): CoreHelpers {
  const { names, alloc, state, isKind, text, retain, release } = base;
  const classPointer = (name: string): number => {
    const value = names.get(name);
    if (value === undefined) throw new Error(`Unknown Foundation class ${name}.`);
    return value;
  };
  const singleton = (name: string) => {
    let value = 0;
    return () => (value ||= alloc(classPointer(name)));
  };
  const keyOf = (key: number): string | number => (isKind(key, "NSString") ? text(key) : key);
  const associated: Helpers["associated"] = (self, key, value) => {
    let dict = state.dicts.get(self);
    if (!dict) {
      dict = new Map();
      state.dicts.set(self, dict);
    }
    const name = keyOf(key);
    const previous = dict.get(name);
    if (value || previous) state.enumeration.changed(self);
    if (value) dict.set(name, [retain(key), retain(value)]);
    else dict.delete(name);
    if (!previous) return undefined;
    return (async () => {
      await release(previous[0]);
      await release(previous[1]);
    })();
  };
  const get: Helpers["get"] = (self, key) => state.dicts.get(self)?.get(keyOf(key))?.[1] ?? 0;
  const dictionary: Helpers["dictionary"] = (cls, pairs) => {
    const pointer = alloc(cls);
    for (const [key, value] of pairs) if (key && value) void associated(pointer, key, value);
    return pointer;
  };
  const entries = (pointer: number): [number, number][] =>
    Array.from(state.dicts.get(pointer)?.values() ?? []);
  return { classPointer, singleton, associated, get, dictionary, entries };
}
