import { expect, test } from "vite-plus/test";
import { openZip } from "../../../../web/ipa.mjs";
import { writeZip } from "./zip-writer";
test("backup ZIPs preserve binary data, Unicode names and empty directories", async () => {
  const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 256);
  const blob = await writeZip([
    { path: "retrove.json", contents: new Blob(['{"version":1}']) },
    { path: "data/Documents/sauvegardé.sav", contents: new Blob([bytes]) },
    { path: "data/Library/empty/", contents: new Blob() },
  ]);
  const zip = await openZip(blob);
  expect(zip.directories.has("data/Library/empty")).toBe(true);
  expect(await zip.read("data/Documents/sauvegardé.sav")).toEqual(bytes);
  expect(new TextDecoder().decode(await zip.read("retrove.json"))).toBe('{"version":1}');
});
test("backup ZIP creation rejects ambiguous paths and honors cancellation", async () => {
  for (const path of ["/absolute", "data/../escape", "data//empty", "data\\wrong", "bad\0name"])
    await expect(writeZip([{ path, contents: new Blob() }])).rejects.toThrow("Invalid backup");
  const entry = { path: "same", contents: new Blob() };
  await expect(writeZip([entry, entry])).rejects.toThrow("Duplicate backup");
  const signal = AbortSignal.abort(new Error("Cancelled export"));
  await expect(writeZip([entry], signal)).rejects.toThrow("Cancelled export");
});
