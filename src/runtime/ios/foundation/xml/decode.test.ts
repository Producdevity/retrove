import { expect, test } from "vite-plus/test";
import { decodeXML } from "./decode";
test("XML text recognizes UTF8, UTF16 byte order and declaration encodings without repairing malformed bytes", () => {
  expect(decodeXML(new TextEncoder().encode("<root>é</root>"))).toBe("<root>é</root>");
  const source = "<r>é</r>",
    little = [0xff, 0xfe],
    big = [0xfe, 0xff];
  for (const character of source) {
    const c = character.charCodeAt(0);
    little.push(c & 255, c >>> 8);
    big.push(c >>> 8, c & 255);
  }
  expect(decodeXML(Uint8Array.from(little))).toBe(source);
  expect(decodeXML(Uint8Array.from(big))).toBe(source);
  const header = new TextEncoder().encode("<?xml version='1.0' encoding='ISO-8859-1'?><r>"),
    end = new TextEncoder().encode("</r>");
  expect(decodeXML(Uint8Array.from([...header, 0xe9, ...end]))).toContain("<r>é</r>");
  expect(() => decodeXML(Uint8Array.of(0xc3, 0x28))).toThrow(/encoding/);
  expect(() => decodeXML(new Uint8Array())).toThrow(/empty/);
});
