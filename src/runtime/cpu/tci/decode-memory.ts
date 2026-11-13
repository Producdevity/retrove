import type { TciCursor } from "./cursor";
import { wordPair } from "./decode-arithmetic";
import type { MemoryWidth, Operation } from "./model";
const loads = new Map<string, readonly [MemoryWidth, boolean]>([
  ["ld8u_i32", ["byte", false]],
  ["ld8s_i32", ["byte", true]],
  ["ld16u_i32", ["half", false]],
  ["ld16s_i32", ["half", true]],
  ["ld_i32", ["word", false]],
]);
const stores = new Map<string, MemoryWidth>([
  ["st8_i32", "byte"],
  ["st16_i32", "half"],
  ["st_i32", "word"],
]);
export function decodeMemory(name: string, cursor: TciCursor): Operation | undefined {
  const load = loads.get(name);
  if (load)
    return {
      kind: "host-load",
      destination: cursor.destination(),
      base: cursor.source(),
      offset: cursor.word(),
      width: load[0],
      signed: load[1],
    };
  const store = stores.get(name);
  if (store)
    return {
      kind: "host-store",
      value: cursor.source(),
      base: cursor.source(),
      offset: cursor.word(),
      width: store,
    };
  if (name === "qemu_ld_i32" || name === "qemu_ld_i64") {
    const destinations = [cursor.destination()];
    if (name === "qemu_ld_i64") destinations.push(cursor.destination());
    return { kind: "guest-load", destinations, address: cursor.source(), mode: cursor.word() };
  }
  if (name === "qemu_st_i32" || name === "qemu_st_i64") {
    const value = name === "qemu_st_i64" ? cursor.pair() : wordPair(cursor);
    return { kind: "guest-store", value, address: cursor.source(), mode: cursor.word() };
  }
  return undefined;
}
