import { expect, test, vi } from "vite-plus/test";
import type { Operand, Operation, TciBlock, UnaryOperation } from "../model";
import { compileTci } from "./compile";
function constant(value: number): Operand {
  return { kind: "constant", value };
}
function register(index: number): Operand {
  return { kind: "register", index };
}
function block(operations: readonly Operation[]): TciBlock {
  return {
    address: 0x1000,
    instructions: operations.map((operation, index) => ({
      operation,
      address: 0x1000 + index * 16,
      next: 0x1010 + index * 16,
    })),
  };
}
function fixture() {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const table = new WebAssembly.Table({ initial: 1, element: "anyfunc" });
  const load = vi.fn(() => 0x89abcdef01234567n),
    store = vi.fn();
  const host = { memory, table, load, store, pc: 0x208 };
  const read = (index: number) => new DataView(memory.buffer).getUint32(0x100 + index * 4, true);
  const write = (index: number, value: number) =>
    new DataView(memory.buffer).setUint32(0x100 + index * 4, value, true);
  return {
    host,
    read,
    write,
    run: (operations: readonly Operation[]) => {
      const run = compileTci(block(operations), host);
      return () => run(0x100, 0x200, 0x204);
    },
  };
}
const exit: Operation = { kind: "exit", value: 0xaabbccdd };

test("compiled control flow handles backward edges, skipped regions and fallthrough", () => {
  const { host, run, read } = fixture();
  const execute = run([
    { kind: "move", destination: 0, value: constant(0) },
    { kind: "binary", operator: "add", destination: 0, left: register(0), right: constant(1) },
    {
      kind: "conditional",
      target: 0x1010,
      condition: "ltu",
      wide: false,
      left: [register(0), constant(0)],
      right: [constant(100), constant(0)],
    },
    { kind: "branch", target: 0x1050 },
    { kind: "move", destination: 0, value: constant(0xbad) },
    exit,
  ]);
  expect(execute()).toBe(1);
  expect(read(0)).toBe(100);
  expect(new DataView(host.memory.buffer).getUint32(0x204, true)).toBe(0xaabbccdd);
});

test("compiled pair arithmetic keeps overlapping inputs and full carry/borrow", () => {
  const { run, read, write } = fixture();
  const operators: readonly ("add" | "sub" | "mul")[] = ["add", "sub", "mul"];
  for (const operator of operators) {
    const execute = run([
      {
        kind: "pair",
        operator,
        low: 0,
        high: 1,
        left: [register(0), register(1)],
        right: [register(2), register(3)],
      },
      exit,
    ]);
    const values = [
      0n,
      1n,
      0xffffffffn,
      0x8000000000000000n,
      0xffffffffffffffffn,
      0x123456789abcdef0n,
    ];
    for (const left of values)
      for (const right of values) {
        write(0, Number(left & 0xffffffffn));
        write(1, Number(left >> 32n));
        write(2, Number(right & 0xffffffffn));
        write(3, Number(right >> 32n));
        execute();
        const expected = BigInt.asUintN(
          64,
          operator === "add" ? left + right : operator === "sub" ? left - right : left * right,
        );
        expect(BigInt(read(0)) | (BigInt(read(1)) << 32n)).toBe(expected);
      }
  }
});

test("compiled byte operations preserve signed extension, masked values and swaps", () => {
  const { run, read, write } = fixture();
  const cases: readonly [UnaryOperation, number][] = [
    ["not", 0x76ab3210],
    ["neg", 0x76ab3211],
    ["ext8s", 0xffffffef],
    ["ext16s", 0xffffcdef],
    ["ext8u", 0xef],
    ["ext16u", 0xcdef],
    ["bswap16", 0xefcd],
    ["bswap32", 0xefcd5489],
  ];
  for (const [operator, expected] of cases) {
    write(0, 0x8954cdef);
    run([{ kind: "unary", operator, destination: 0, value: register(0) }, exit])();
    expect(read(0), operator).toBe(expected);
  }
  write(0, 0xffffffff);
  write(1, 0x12345678);
  run([
    {
      kind: "deposit",
      destination: 0,
      left: register(0),
      right: register(1),
      position: 4,
      width: 12,
    },
    exit,
  ])();
  expect(read(0)).toBe(0xffff678f);
  run([
    {
      kind: "deposit",
      destination: 0,
      left: register(0),
      right: constant(0),
      position: 1,
      width: 31,
    },
    exit,
  ])();
  expect(read(0)).toBe(1);
});

test("compiled guest access uses host helpers with the original fault address and next instruction", () => {
  const { host, run, read, write } = fixture();
  write(14, 0x1234);
  write(2, 0x87654321);
  run([
    { kind: "guest-load", destinations: [0, 1], address: register(2), mode: 0x33 },
    { kind: "guest-store", value: [register(0), register(1)], address: register(2), mode: 0x23 },
    exit,
  ])();
  expect(host.load).toHaveBeenCalledExactlyOnceWith(0x1234, 0x87654321 | 0, 0x33, 0x1010);
  expect(host.store).toHaveBeenCalledExactlyOnceWith(
    0x1234,
    0x87654321 | 0,
    BigInt.asIntN(64, 0x89abcdef01234567n),
    0x23,
    0x1020,
  );
  expect(read(0)).toBe(0x01234567);
  expect(read(1)).toBe(0x89abcdef);
  expect(new DataView(host.memory.buffer).getUint32(host.pc, true)).toBe(0x1010);
  const failure = new Error("guest permission fault");
  host.load.mockImplementation(() => {
    throw failure;
  });
  expect(
    run([{ kind: "guest-load", destinations: [0], address: register(2), mode: 0 }, exit]),
  ).toThrow(failure);
  expect(new DataView(host.memory.buffer).getUint32(host.pc, true)).toBe(0x1000);
});

test("compiled links read live displacements after memory growth", () => {
  const { host, run, write, read } = fixture();
  const execute = run([{ kind: "jump", cell: 0x300 }]);
  write(3, 0xfeedface);
  new DataView(host.memory.buffer).setInt32(0x300, 0x100, true);
  expect(execute()).toBe(0);
  expect(new DataView(host.memory.buffer).getUint32(0x200, true)).toBe(0x404);
  host.memory.grow(1);
  new DataView(host.memory.buffer).setInt32(0x300, -0x100, true);
  expect(execute()).toBe(0);
  expect(new DataView(host.memory.buffer).getUint32(0x200, true)).toBe(0x204);
  expect(read(3)).toBe(0xfeedface);
});

test("compiled comparisons distinguish signed and unsigned 64-bit values", () => {
  const { run, read, write } = fixture();
  const cases: readonly ["lt" | "ge" | "ltu" | "geu" | "eq" | "ne", number][] = [
    ["lt", 1],
    ["ge", 0],
    ["ltu", 0],
    ["geu", 1],
    ["eq", 0],
    ["ne", 1],
  ];
  write(0, 0);
  write(1, 0x80000000);
  write(2, 0xffffffff);
  write(3, 0x7fffffff);
  for (const [condition, expected] of cases) {
    run([
      {
        kind: "compare",
        destination: 4,
        wide: true,
        condition,
        left: [register(0), register(1)],
        right: [register(2), register(3)],
      },
      exit,
    ])();
    expect(read(4), condition).toBe(expected);
  }
});
