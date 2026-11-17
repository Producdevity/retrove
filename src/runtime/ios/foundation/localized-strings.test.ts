import { expect, test } from "vite-plus/test";
import { bundleStrings, parseStringsTable } from "./localized-strings";

const encode = (text: string) => new TextEncoder().encode(text);

test("old-style strings tables decode escapes and skip comments", () => {
  const table = parseStringsTable(encode('/* c */ "a" = "x\\n\\U0041\\101"; // d\nb = "y";'));
  expect([...table]).toEqual([
    ["a", "x\nAA"],
    ["b", "y"],
  ]);
  expect(() => parseStringsTable(encode('"a" "b";'))).toThrow("Malformed");
});

test("bundle lookups prefer the development region and cache tables", async () => {
  let reads = 0;
  const lookup = bundleStrings({
    info: { CFBundleDevelopmentRegion: "fr" },
    bundlePath: "/App.app",
    has: (path) => path === "/App.app/fr.lproj/Localizable.strings",
    read: async () => {
      reads++;
      return encode('"hello" = "bonjour";');
    },
  });
  expect(await lookup("hello")).toBe("bonjour");
  expect(await lookup("missing")).toBeUndefined();
  expect(reads).toBe(1);
  await expect(lookup("a", "../x")).rejects.toThrow("Invalid bundle");
});
