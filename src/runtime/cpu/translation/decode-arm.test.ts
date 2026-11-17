import { describe, expect, test } from "vite-plus/test";
import { decode } from "./decode-arm";
import { DataOp, Register } from "./instruction";
import { decodeThumbRange } from "./thumb-range";

const thumb = (halves: readonly number[], start = 0x1000) =>
  decodeThumbRange(start, start + 2 * halves.length, (address) => halves[(address - start) / 2]);

describe("ARM decoder", () => {
  test("decodes data processing, branches and loads", () => {
    expect(decode(0xe0810002, 0x1000)).toEqual({
      cond: 14,
      kind: "data",
      op: DataOp.ADD,
      s: false,
      rn: 1,
      rd: 0,
      operand: { kind: "reg", rm: 2, shift: 0, amount: 0 },
    });
    expect(decode(0xe12fff1e, 0)).toEqual({ cond: 14, kind: "bx", link: false, rm: Register.LR });
    expect(decode(0xeb000010, 0x1000)).toEqual({
      cond: 14,
      kind: "branch",
      link: true,
      target: 0x1048,
    });
    expect(decode(0xe59f0004, 0)).toMatchObject({
      kind: "mem",
      load: true,
      size: 4,
      rn: Register.PC,
      rd: 0,
      offset: { kind: "imm", value: 4 },
      add: true,
      pre: true,
      writeback: false,
    });
  });

  test("decodes divide, hints and VFP arithmetic", () => {
    expect(decode(0xe710f110, 0)).toEqual({
      cond: 14,
      kind: "div",
      signed: true,
      rd: 0,
      rn: 0,
      rm: 1,
    });
    expect(decode(0xe320f000, 0)).toMatchObject({ kind: "data", op: DataOp.MOV, rd: 0 });
    expect(decode(0xee300a01, 0)).toEqual({
      cond: 14,
      kind: "varith",
      op: "add",
      double: false,
      d: 0,
      n: 0,
      m: 2,
    });
    expect(decode(0xe7f000f0, 0)).toEqual({ cond: 14, kind: "unsupported" });
  });
});

describe("Thumb decoder", () => {
  test("decodes 16- and 32-bit forms", () => {
    const [add, bx, load] = thumb([0x4408, 0x4770, 0xf8d1, 0x0004]);
    expect(add?.instruction).toMatchObject({
      kind: "data",
      op: DataOp.ADD,
      s: false,
      rn: 0,
      rd: 0,
    });
    expect(bx?.instruction).toEqual({ cond: 14, kind: "bx", link: false, rm: Register.LR });
    expect(load).toMatchObject({ address: 0x1004, size: 4 });
    expect(load?.instruction).toMatchObject({
      kind: "mem",
      load: true,
      rn: 1,
      rd: 0,
      offset: { value: 4 },
    });
  });

  test("conditions instructions inside an IT block and stops setting flags", () => {
    const [it, inside, after] = thumb([0xbf08, 0x2001, 0x2002]);
    expect(it?.instruction).toMatchObject({ kind: "data", op: DataOp.MOV, rd: 0 });
    expect(inside).toMatchObject({ itStart: 0x1000, instruction: { cond: 0, s: false } });
    expect(after?.itStart).toBeUndefined();
    expect(after?.instruction).toMatchObject({ cond: 14, s: true });
  });

  test("decodes BL with the Thumb bit in the target", () => {
    const [call] = thumb([0xf000, 0xf800]);
    expect(call?.instruction).toEqual({ cond: 14, kind: "branch", link: true, target: 0x1005 });
  });
});
