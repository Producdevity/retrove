import { expect, test } from "vite-plus/test";
import { SymbolIndex } from "./symbol-index";
test("indexed symbols honor sections, Thumb addresses and the first alias", () => {
  const names = new TextEncoder().encode("\0first\0alias\0second\0debug\0other\0");
  const table = new Uint8Array(6 * 12),
    view = new DataView(table.buffer);
  const values = [
    [7, 0x0e, 1, 0x1000],
    [1, 0x0e, 1, 0x1000],
    [13, 0x0e, 1, 0x1020],
    [20, 0xee, 1, 0x1010],
    [26, 0x0e, 2, 0x2000],
    [1, 0x0e, 1, 0x3000],
  ];
  values.forEach(([name = 0, kind = 0, section = 0, address = 0], index) => {
    view.setUint32(index * 12, name, true);
    view.setUint8(index * 12 + 4, kind);
    view.setUint8(index * 12 + 5, section);
    view.setUint32(index * 12 + 8, address, true);
  });
  const index = new SymbolIndex(table, names, [
    { address: 0x1000, size: 0x100 },
    { address: 0x2000, size: 0x100 },
  ]);
  expect(index.lookup(0x1001)).toEqual({ name: "alias", offset: 0 });
  expect(index.lookup(0x1010)).toEqual({ name: "alias", offset: 16 });
  expect(index.lookup(0x1024)).toEqual({ name: "second", offset: 4 });
  expect(index.lookup(0x2000)).toEqual({ name: "other", offset: 0 });
  expect(index.lookup(0x1100)).toBeUndefined();
  expect(index.lookup(0x3000)).toBeUndefined();
});
