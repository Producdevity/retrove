import { expect, test } from "vite-plus/test";
import { classicRelocations } from "./classic-relocations";

function fixture() {
  const bytes = new Uint8Array(0x2000);
  const symbols = new DataView(new ArrayBuffer(12));
  symbols.setUint32(0, 1, true);
  symbols.setUint8(4, 1);
  symbols.setUint16(6, 0x140, true);
  const relocations = new DataView(new ArrayBuffer(8));
  relocations.setUint32(0, 0x5010, true);
  relocations.setUint32(4, 0x0c000000, true);
  new DataView(bytes.buffer).setInt32(0x1010, -4, true);
  return {
    bytes,
    symbols,
    relocations,
    strings: new TextEncoder().encode("\0_external\0"),
    dylibs: ["Foundation"],
    flags: 0x80,
    segments: [
      { address: 0, size: 0x4000, fileOffset: 0, fileSize: 0, protection: 0 },
      { address: 0x4000, size: 0x1000, fileOffset: 0, fileSize: 0x1000, protection: 5 },
      { address: 0x5000, size: 0x2000, fileOffset: 0x1000, fileSize: 0x1000, protection: 3 },
    ],
  };
}
test("classic ARM bindings retain signed addends and weak library imports", () => {
  expect(classicRelocations(fixture())).toEqual([
    {
      address: 0x5010,
      name: "_external",
      library: "Foundation",
      ordinal: 1,
      kind: 1,
      mode: "normal",
      weak: true,
      addend: -4,
    },
  ]);
});
test("split segments use the first writable base and remove prior prebinding", () => {
  const input = fixture();
  input.flags |= 0x30;
  input.relocations.setUint32(0, 0x10, true);
  input.symbols.setUint32(8, 0x1000, true);
  new DataView(input.bytes.buffer).setUint32(0x1010, 0x1014, true);
  expect(classicRelocations(input)[0]?.addend).toBe(20);
  expect(classicRelocations(input)[0]?.address).toBe(0x5010);
  input.relocations.setUint32(0, 0x1000, true);
  input.flags &= ~0x10;
  expect(classicRelocations(input)[0]?.addend).toBe(0);
});
test("classic imports distinguish flat and special library ordinals", () => {
  const input = fixture();
  input.flags = 0;
  expect(classicRelocations(input)[0]?.ordinal).toBe(-2);
  input.flags = 0x80;
  input.symbols.setUint16(6, 0xff00, true);
  expect(classicRelocations(input)[0]?.ordinal).toBe(-1);
});
test("malformed relocation fields fail before binding or mapping", () => {
  for (const [address, bits] of [
    [0, 0x0c000000],
    [0x5011, 0x0c000000],
    [0x80005010, 0x0c000000],
    [0x7000, 0x0c000000],
    [0x5010, 0x0d000000],
    [0x5010, 0x1c000000],
    [0x5010, 0x08000000],
    [0x5010, 0x0c000001],
  ] as const) {
    const input = fixture();
    input.relocations.setUint32(0, address, true);
    input.relocations.setUint32(4, bits, true);
    expect(() => classicRelocations(input)).toThrow("Mach-O:");
  }
  const input = fixture();
  input.symbols.setUint16(6, 0x200, true);
  expect(() => classicRelocations(input)).toThrow("ordinal");
  input.symbols.setUint16(6, 0x100, true);
  input.symbols.setUint32(0, 100, true);
  expect(() => classicRelocations(input)).toThrow("name");
});
