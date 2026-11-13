import { expect, test } from "vite-plus/test";
import { decodeTci } from "./decode";
import { UnsupportedTciOperation, type TciAbi } from "./model";
const names = [
  "movi_i32",
  "mov_i32",
  "add_i32",
  "setcond2_i32",
  "brcond_i32",
  "goto_tb",
  "exit_tb",
  "qemu_ld_i64",
  "deposit_i32",
  "call",
  "add2_i32",
  "unsupported",
];
const abi: TciAbi = {
  opcodes: new Map(names.map((name, index) => [index, name])),
  comparisons: new Map([[73, "eq"]]),
};
function word(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return [...bytes];
}
function instruction(name: string, ...fields: number[]): Uint8Array {
  const opcode = names.indexOf(name);
  if (opcode < 0) throw new Error("Unknown test opcode.");
  return Uint8Array.from([opcode, fields.length + 2, ...fields]);
}
test("decoding follows the supplied build manifest and preserves unsigned constants", () => {
  const code = instruction("movi_i32", 0, ...word(0xffff_ffff));
  expect(decodeTci(code, 0x1000, abi).instructions).toEqual([
    {
      address: 0x1000,
      next: 0x1007,
      operation: { kind: "move", destination: 0, value: { kind: "constant", value: 0xffff_ffff } },
    },
  ]);
  const add = instruction("add_i32", 2, 0, 255, ...word(9));
  expect(decodeTci(add, 0, abi).instructions[0]?.operation).toEqual({
    kind: "binary",
    operator: "add",
    destination: 2,
    left: { kind: "register", index: 0 },
    right: { kind: "constant", value: 9 },
  });
});
test("paired comparisons, guest loads and helper operands retain their distinct layouts", () => {
  const comparison = instruction("setcond2_i32", 4, 0, 1, 255, ...word(3), 2, 73);
  expect(decodeTci(comparison, 0, abi).instructions[0]?.operation).toMatchObject({
    kind: "compare",
    destination: 4,
    wide: true,
    condition: "eq",
    right: [
      { kind: "constant", value: 3 },
      { kind: "register", index: 2 },
    ],
  });
  const load = instruction("qemu_ld_i64", 0, 1, 3, ...word(0x23));
  expect(decodeTci(load, 0, abi).instructions[0]?.operation).toEqual({
    kind: "guest-load",
    destinations: [0, 1],
    address: { kind: "register", index: 3 },
    mode: 0x23,
  });
  expect(
    decodeTci(instruction("call", 255, ...word(900)), 0, abi).instructions[0]?.operation,
  ).toEqual({ kind: "call", target: { kind: "constant", value: 900 } });
});
test("linked jumps retain the live aligned cell rather than its current target", () => {
  const jump = instruction("goto_tb", 0, 0, 0, ...word(1234));
  expect(decodeTci(jump, 0x1003, abi).instructions[0]?.operation).toEqual({
    kind: "jump",
    cell: 0x1008,
  });
  const exit = instruction("exit_tb", ...word(0xfeed_cafe), ...word(0x1234));
  expect(decodeTci(exit, 0, abi).instructions[0]?.operation).toEqual({
    kind: "exit",
    value: 0xfeed_cafe,
  });
});
test("branches must address complete instructions within the translated block", () => {
  const branch = (target: number) =>
    instruction("brcond_i32", 0, 255, ...word(0), 73, ...word(target));
  expect(decodeTci(branch(0x1000), 0x1000, abi).instructions[0]?.operation).toMatchObject({
    kind: "conditional",
    target: 0x1000,
    wide: false,
  });
  expect(() => decodeTci(branch(0x1001), 0x1000, abi)).toThrow(/boundary/);
  expect(() => decodeTci(branch(0x2000), 0x1000, abi)).toThrow(/boundary/);
});
test("malformed lengths, reserved destinations and unrecognized operations cannot compile", () => {
  for (const code of [
    Uint8Array.of(0),
    Uint8Array.of(0, 0),
    Uint8Array.of(0, 1),
    Uint8Array.of(0, 9),
    instruction("movi_i32", 0),
    instruction("movi_i32", 0, ...word(1), 7),
  ])
    expect(() => decodeTci(code, 0, abi)).toThrow(RangeError);
  for (const destination of [14, 15, 16, 255])
    expect(() => decodeTci(instruction("movi_i32", destination, ...word(1)), 0, abi)).toThrow();
  expect(() => decodeTci(instruction("unsupported"), 0, abi)).toThrow(UnsupportedTciOperation);
  expect(() => decodeTci(Uint8Array.of(254, 2), 0, abi)).toThrow(UnsupportedTciOperation);
  expect(() => decodeTci(instruction("add2_i32", 0, 0, 1, 2, 3, 4), 0, abi)).toThrow(/overlap/);
  expect(() => decodeTci(instruction("deposit_i32", 0, 1, 2, 31, 2), 0, abi)).toThrow(/bitfield/);
});
