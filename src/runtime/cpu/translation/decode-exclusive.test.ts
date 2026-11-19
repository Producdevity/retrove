import { expect, test } from "vite-plus/test";
import { decode } from "./decode-arm";
import { nop } from "./instruction";
import { decodeThumb32 } from "./thumb-32";

const Always = 14;
const exclusive = (load: boolean, size: number, rn: number, rt: number, rt2: number, rd: number) =>
  ({ cond: Always, kind: "exclusive", load, size, rn, rt, rt2, rd, offset: 0 }) as const;
const fence = { cond: Always, kind: "sync", clear: false } as const;
const clear = { cond: Always, kind: "sync", clear: true } as const;

test.each([
  ["ldrex r2, [r1]", 0xe1912f9f, exclusive(true, 4, 1, 2, 0, 0)],
  ["strex r3, r2, [r1]", 0xe1813f92, exclusive(false, 4, 1, 2, 0, 3)],
  ["ldrexb r2, [r0]", 0xe1d02f9f, exclusive(true, 1, 0, 2, 0, 0)],
  ["strexb r3, r2, [r1]", 0xe1c13f92, exclusive(false, 1, 1, 2, 0, 3)],
  ["ldrexh r2, [r0]", 0xe1f02f9f, exclusive(true, 2, 0, 2, 0, 0)],
  ["strexh r3, r2, [r1]", 0xe1e13f92, exclusive(false, 2, 1, 2, 0, 3)],
  ["ldrexd r4, r5, [r0]", 0xe1b04f9f, exclusive(true, 8, 0, 4, 5, 0)],
  ["strexd r3, r4, r5, [r1]", 0xe1a13f94, exclusive(false, 8, 1, 4, 5, 3)],
  ["clrex", 0xf57ff01f, clear],
  ["dmb ish", 0xf57ff05b, fence],
  ["dsb sy", 0xf57ff04f, fence],
  ["isb sy", 0xf57ff06f, fence],
])("ARM %s", (_, word, expected) => {
  expect(decode(word, 0x1000)).toEqual(expected);
});

test("ARM doubleword exclusives need an even first register below LR", () => {
  expect(decode(0xe1b05f9f, 0x1000).kind).toBe("unsupported"); // ldrexd r5, r6, [r0]
  expect(decode(0xe1b0ef9f, 0x1000).kind).toBe("unsupported"); // ldrexd lr, pc, [r0]
});

test.each([
  ["ldrex r2, [r1, #4]", 0xe851, 0x2f01, { ...exclusive(true, 4, 1, 2, 0, 0), offset: 4 }],
  ["strex r3, r2, [r1, #4]", 0xe841, 0x2301, { ...exclusive(false, 4, 1, 2, 0, 3), offset: 4 }],
  ["ldrexb r2, [r0]", 0xe8d0, 0x2f4f, exclusive(true, 1, 0, 2, 0, 0)],
  ["strexb r3, r2, [r1]", 0xe8c1, 0x2f43, exclusive(false, 1, 1, 2, 0, 3)],
  ["ldrexh r2, [r0]", 0xe8d0, 0x2f5f, exclusive(true, 2, 0, 2, 0, 0)],
  ["strexh r3, r2, [r1]", 0xe8c1, 0x2f53, exclusive(false, 2, 1, 2, 0, 3)],
  ["ldrexd r4, r5, [r0]", 0xe8d0, 0x457f, exclusive(true, 8, 0, 4, 5, 0)],
  ["strexd r3, r4, r5, [r1]", 0xe8c1, 0x4573, exclusive(false, 8, 1, 4, 5, 3)],
  ["clrex", 0xf3bf, 0x8f2f, clear],
  ["dmb ish", 0xf3bf, 0x8f5b, fence],
  ["dsb sy", 0xf3bf, 0x8f4f, fence],
  ["isb sy", 0xf3bf, 0x8f6f, fence],
  ["tbb [r0, r1]", 0xe8d0, 0xf001, { kind: "table", half: false }],
])("Thumb %s", (_, h1, h2, expected) => {
  expect(decodeThumb32(h1, h2, 0x1000, Always)).toMatchObject(expected);
});

test("other Thumb hints stay no-ops", () => {
  expect(decodeThumb32(0xf3af, 0x8000, 0x1000, Always)).toEqual(nop()); // nop.w
  expect(decodeThumb32(0xf3bf, 0x8f7f, 0x1000, Always)).toEqual(nop());
});
