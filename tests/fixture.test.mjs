import {test} from "vite-plus/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { openIPA } from "../src/runtime/ios/package/ipa.ts";
import { runGuest } from "../src/runtime/ios/runtime/runtime.ts";

const fixture = new URL("./fixtures/smoke.ipa", import.meta.url);
async function app() {
  return openIPA(new Blob([await readFile(fixture)]));
}

function captureClear() {
  const calls = [];
  const gl = {
    isContextLost: () => false,
    clearColor: (...color) => { calls.push(["clearColor", ...color.map(n => Math.round(n * 255))]); },
    clear: mask => { calls.push(["clear", mask]); }
  };
  return { calls, graphics: () => gl };
}

test("ARMv7 constructor, dyld calls and compressed bundle asset drive a GLES clear", async () => {
  const ipa = await app();
  const target = captureClear();
  let summary;
  const result = await runGuest(ipa, { ...target, report: s => { summary = s; } });
  assert.deepEqual(result, { exitStatus: 0, calls: 5 });
  assert.equal(summary.initializers, 1);
  assert.deepEqual(summary.unsupported, []);
  assert.deepEqual(target.calls, [["clearColor", 51, 102, 153, 255], ["clear", 0x4000]]);
});

test("guest rejects malformed color data before issuing any GLES calls", async () => {
  const ipa = await app();
  const damaged = { ...ipa, async read(path) {
    const contents = await ipa.read(path);
    if (path.endsWith("/rgba.bin")) contents[0] ^= 1;
    return contents;
  }};
  const target = captureClear();
  assert.deepEqual(await runGuest(damaged, target), { exitStatus: 5, calls: 3 });
  assert.deepEqual(target.calls, []);
});

test("changing the valid bundle asset changes the rendered color", async () => {
  const ipa = await app();
  const replacement = new Uint8Array(20), words = new DataView(replacement.buffer);
  let checksum = 0;
  for (const [i, value] of [0.75, 0, 0.25, 1].entries()) {
    words.setFloat32(i * 4, value, true);
    checksum ^= words.getUint32(i * 4, true);
  }
  words.setUint32(16, checksum, true);
  const target = captureClear();
  const alternate = { ...ipa, read: path => path.endsWith("/rgba.bin") ? replacement : ipa.read(path) };
  assert.deepEqual(await runGuest(alternate, target), { exitStatus: 0, calls: 5 });
  assert.deepEqual(target.calls, [["clearColor", 191, 0, 64, 255], ["clear", 0x4000]]);
});
