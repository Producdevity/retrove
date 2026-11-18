import { expect, test } from "vite-plus/test";
import { glyphCharacters } from "./font-tables";
import { glyphText } from "./text";

/** A font with only a Windows BMP format 4 cmap: 'A'..'C' map to glyphs 36..38. */
function font(): Uint8Array {
  const bytes = new Uint8Array(96),
    data = new DataView(bytes.buffer);
  data.setUint16(4, 1);
  bytes.set(new TextEncoder().encode("cmap"), 12);
  data.setUint32(20, 28);
  const cmap = 28;
  data.setUint16(cmap + 2, 1);
  data.setUint16(cmap + 4, 3);
  data.setUint16(cmap + 6, 1);
  data.setUint32(cmap + 8, 12);
  const table = cmap + 12;
  data.setUint16(table, 4);
  data.setUint16(table + 6, 4);
  data.setUint16(table + 14, 67);
  data.setUint16(table + 16, 0xffff);
  data.setUint16(table + 20, 65);
  data.setUint16(table + 22, 0xffff);
  data.setUint16(table + 24, 36 - 65 + 0x10000);
  data.setUint16(table + 26, 1);
  return bytes;
}

test("cmap tables map glyph IDs back to the characters that select them", () => {
  const characters = glyphCharacters(font());
  expect([...characters]).toEqual([
    [36, 65],
    [37, 66],
    [38, 67],
  ]);
  expect(glyphText(characters, [38, 36, 99])).toBe("CA�");
  expect(() => glyphCharacters(new Uint8Array(12))).toThrow("no cmap");
});
