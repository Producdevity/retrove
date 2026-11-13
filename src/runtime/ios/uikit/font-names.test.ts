import { expect, test } from "vite-plus/test";
import { fontNames } from "./font-names";
function font(): Uint8Array {
  const text = "Example-Bold";
  const bytes = new Uint8Array(46 + text.length * 2),
    view = new DataView(bytes.buffer);
  view.setUint16(4, 1);
  view.setUint32(12, 0x6e616d65);
  view.setUint32(20, 28);
  view.setUint32(24, bytes.length - 28);
  view.setUint16(30, 1);
  view.setUint16(32, 18);
  view.setUint16(34, 3);
  view.setUint16(36, 1);
  view.setUint16(38, 0x0409);
  view.setUint16(40, 6);
  view.setUint16(42, text.length * 2);
  view.setUint16(44, 0);
  Array.from(text).forEach((character, index) =>
    view.setUint16(46 + index * 2, character.charCodeAt(0)),
  );
  return bytes;
}
test("reads an OpenType PostScript name from a bounded table", () => {
  expect(fontNames(font())).toEqual(["Example-Bold"]);
});
test("rejects a name record outside the name table, even inside the font", () => {
  const bytes = font();
  new DataView(bytes.buffer).setUint32(24, 18);
  expect(() => fontNames(bytes)).toThrow("Invalid font table bounds");
});
