import type { FoundationHost } from "../objc/host";
const DICTIONARY_CLASS = "NSDictionary";
interface DictionaryHost extends Pick<FoundationHost, "method" | "autorelease" | "release"> {
  items(pointer: number): readonly number[];
  copyKey(pointer: number): Promise<number>;
  dictionary(type: number, pairs: readonly (readonly [number, number])[]): number;
}
export function installDictionaryArrays(host: DictionaryHost): void {
  host.method(DICTIONARY_CLASS, true, "dictionaryWithObjects:forKeys:", async (type, args) => {
    const values = [...host.items(args(0))],
      keys = [...host.items(args(1))];
    if (values.length !== keys.length) throw new Error("NSDictionary key and value counts differ.");
    if (values.includes(0) || keys.includes(0)) throw new Error("Cannot add nil to NSDictionary.");
    const copies: number[] = [];
    try {
      for (const key of keys) copies.push(await host.copyKey(key));
      const pairs: [number, number][] = [];
      for (const [index, key] of copies.entries()) {
        const value = values[index];
        if (value === undefined) throw new Error("Missing NSDictionary value.");
        pairs.push([key, value]);
      }
      return host.autorelease(host.dictionary(type, pairs));
    } finally {
      for (const key of copies) await host.release(key);
    }
  });
}
