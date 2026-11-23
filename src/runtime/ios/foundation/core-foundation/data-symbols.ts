import type { CoreFoundationHost } from "./types";
import { Argument, type CoreFoundationFunction } from "./types";

const WORD = Uint32Array.BYTES_PER_ELEMENT;
const NAN_SYMBOL = "_kCFNumberNaN";
const KEY_CALLBACKS = "_kCFTypeDictionaryKeyCallBacks";
const VALUE_CALLBACKS = "_kCFTypeDictionaryValueCallBacks";
const ARRAY_CALLBACKS = "_kCFTypeArrayCallBacks";
const KEY_OPERATIONS = 5;
const VALUE_OPERATIONS = 4;

/** The kCFNumberNaN object and the kCFType callback tables, created on first lookup. */
export function dataSymbols(host: CoreFoundationHost): (name: string) => number | null {
  const { foundation, send } = host;
  const constants = new Map<string, number>();
  const callbacks: [string, (a: (index: number) => number) => unknown][] = [
    ["retain", (a) => host.retain(a(Argument.Second))],
    ["release", (a) => host.release(a(Argument.Second))],
    ["description", (a) => host.makeString(foundation.description(a(0)))],
    ["equal", (a) => (host.equal ? host.equal(a(0), a(1)) : send(a(0), "isEqual:", [a(1)]))],
    ["hash", (a) => (host.hash ? host.hash(a(0)) : send(a(0), "hash"))],
  ];
  function table(name: string): number {
    const operations = callbacks.slice(
      0,
      name.includes("KeyCall") ? KEY_OPERATIONS : VALUE_OPERATIONS,
    );
    const pointer = host.zero(WORD * (operations.length + 1));
    for (const [i, [operation, handler]] of operations.entries())
      host.write(pointer + WORD * (i + 1), host.hostGate({ name: `CFType.${operation}` }, handler));
    return pointer;
  }
  return (name) => {
    const known = constants.get(name);
    if (known !== undefined) return known;
    let pointer: number;
    if (name === NAN_SYMBOL) {
      pointer = host.zero(WORD);
      host.write(pointer, host.retain(foundation.number(NaN)));
    } else if ([KEY_CALLBACKS, VALUE_CALLBACKS, ARRAY_CALLBACKS].includes(name))
      pointer = table(name);
    else return null;
    constants.set(name, pointer);
    return pointer;
  };
}
export type { CoreFoundationFunction };
