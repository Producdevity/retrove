import { expect, test } from "vite-plus/test";
import { ArchiveReference } from "../../ios/foundation/archives/graph";
import { parsePlist } from ".";

const xml = (body: string) =>
  new TextEncoder().encode(
    `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "x"><plist version="1.0">${body}</plist>`,
  );

test("XML plists decode Apple's value vocabulary", () => {
  const value = parsePlist(
    xml(
      "<dict><key>a</key><array><integer>9007199254740993</integer><real>1.5</real><true/><string>&lt;&#x41;</string><data>AQI=</data></array><key>__proto__</key><string/></dict>",
    ),
  );
  expect(value).toEqual({
    a: [9007199254740993n, 1.5, true, "<A", Uint8Array.of(1, 2)],
    ["__proto__"]: "",
  });
  expect(Object.getPrototypeOf(value)).toBeNull();
});

test("XML plists reject missing keys and duplicate keys", () => {
  expect(() => parsePlist(xml("<dict><string>a</string></dict>"))).toThrow("dictionary key");
  expect(() => parsePlist(xml("<dict><key>a</key><true/><key>a</key><false/></dict>"))).toThrow(
    "dictionary key",
  );
});

const binary = (objects: number[][], root = 0) => {
  const header = [...new TextEncoder().encode("bplist00")];
  const offsets: number[] = [];
  const body: number[] = [];
  for (const object of objects) {
    offsets.push(header.length + body.length);
    body.push(...object);
  }
  const table = header.length + body.length;
  const trailer = new Array<number>(32).fill(0);
  trailer[6] = 1;
  trailer[7] = 1;
  trailer[15] = objects.length;
  trailer[23] = root;
  trailer[31] = table;
  return Uint8Array.from([...header, ...body, ...offsets, ...trailer]);
};

test("binary plists decode dictionaries, integers, strings and UIDs", () => {
  const value = parsePlist(
    binary([
      [0xd2, 1, 2, 3, 4],
      [0x51, 0x61],
      [0x51, 0x62],
      [0x10, 0xff],
      [0x80, 7],
    ]),
  );
  expect(value).toEqual({ a: 255, b: new ArchiveReference(7) });
});

test("binary plists reject reference cycles", () => {
  expect(() => parsePlist(binary([[0xa1, 0]]))).toThrow("reference");
});
