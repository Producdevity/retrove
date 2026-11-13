import { expect, test } from "vite-plus/test";
import { readTciAbi } from "./manifest";
function fixture() {
  const constants: readonly (readonly [string, number])[] = [
    ["register_count", 16],
    ["environment_register", 14],
    ["stack_register", 15],
    ["constant_operand", 255],
    ...["EQ", "NE", "LT", "GE", "LE", "GT", "LTU", "GEU", "LEU", "GTU"].map(
      (name, value): readonly [string, number] => [`condition_${name}`, value],
    ),
    ["movi_i32", 90],
    ["exit_tb", 91],
  ];
  const bytes = new Uint8Array(2048),
    view = new DataView(bytes.buffer);
  const table = 64;
  let nameAt = 512;
  constants.forEach(([name, value], index) => {
    const encoded = new TextEncoder().encode(name);
    bytes.set(encoded, nameAt);
    view.setUint32(table + index * 8, nameAt, true);
    view.setUint32(table + index * 8 + 4, value, true);
    nameAt += encoded.length + 1;
  });
  return { bytes, view, table, count: constants.length };
}
test("the build manifest supplies opcode and condition numbers independently", () => {
  const f = fixture(),
    abi = readTciAbi(f.bytes, f.table, f.count);
  expect(abi.opcodes).toEqual(
    new Map([
      [90, "movi_i32"],
      [91, "exit_tb"],
    ]),
  );
  expect(abi.comparisons.get(0)).toBe("eq");
  expect(abi.comparisons.get(9)).toBe("gtu");
});
test("invalid layouts, duplicate opcode IDs and out-of-bounds names are rejected", () => {
  const f = fixture();
  expect(() => readTciAbi(f.bytes, -1, f.count)).toThrow(RangeError);
  expect(() => readTciAbi(f.bytes, f.table, 257)).toThrow(RangeError);
  f.view.setUint32(f.table + 4, 32, true);
  expect(() => readTciAbi(f.bytes, f.table, f.count)).toThrow(/layout/);
  f.view.setUint32(f.table + 4, 16, true);
  f.view.setUint32(f.table + (f.count - 1) * 8 + 4, 90, true);
  expect(() => readTciAbi(f.bytes, f.table, f.count)).toThrow(/opcode/);
  f.view.setUint32(f.table, f.bytes.length, true);
  expect(() => readTciAbi(f.bytes, f.table, f.count)).toThrow(/name/);
});
