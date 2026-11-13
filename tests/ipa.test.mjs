import {test} from "vite-plus/test";
import assert from "node:assert/strict";
import { crc32, deflateRawSync } from "node:zlib";
import { openIPA, openZip, parsePlist } from "../web/ipa.mjs";

const prefix = "Payload/BioShock.app/";
const xml = '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>BioShock</string><key>Example</key><array><true/><integer>12</integer><string>A&amp;B</string></array></dict></plist>';
// Independent fixture written by Python's plistlib.
const binary = Buffer.from("YnBsaXN0MDDWAQIDBAUGBwgJDBARXxATQ0ZCdW5kbGVEaXNwbGF5TmFtZV8QEkNGQnVuZGxlRXhlY3V0YWJsZVVGbGFnc1RJbnRzUlBpWlNhbXBsZURhdGFoAEIAaQBvAFMAaAD4AGMAa1hCaW9TaG9ja6IKCwkIow0ODxABEQTSE///////////I0AJAAAAAAAARGFiY2QIFStARktOWWpzdnd4fH6BipMAAAAAAAABAQAAAAAAAAASAAAAAAAAAAAAAAAAAAAAmA==", "base64");

function zip(files, comment = "") {
  const local = [], directory = [];
  let offset = 0;
  for (const [filename, contents, compressed = true] of files) {
    const name = Buffer.from(filename), bytes = Buffer.from(contents), data = compressed ? deflateRawSync(bytes) : bytes;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(compressed ? 8 : 0, 8);
    header.writeUInt32LE(crc32(bytes), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(compressed ? 8 : 0, 10);
    header.copy(central, 16, 14, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const table = Buffer.concat(directory), text = Buffer.from(comment), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(table.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(text.length, 20);
  return Buffer.concat([...local, table, end, text]);
}

test("reads deflated and stored entries, and ignores nested app metadata", async () => {
  const exe = Buffer.from([0xce, 0xfa, 0xed, 0xfe]);
  const blob = new Blob([zip([[prefix + "Info.plist", xml], [prefix + "BioShock", exe, false],
    [prefix + "PlugIns/Helper.app/Info.plist", xml]], "PK\x05\x06 ZIP comment")]);
  const ipa = await openIPA(blob);
  assert.equal(ipa.bundlePath, "Payload/BioShock.app");
  assert.equal(ipa.executablePath, prefix + "BioShock");
  assert.deepEqual(ipa.info.Example, [true, 12, "A&B"]);
  assert.deepEqual(await ipa.readExecutable(), Uint8Array.from(exe));
  assert.equal(ipa.has(prefix + "Info.plist"), true);
  await assert.rejects(ipa.read(prefix + "Info.plist", { maxBytes: 5 }), /read limit/);
});

test("indexes without reading asset or executable payloads", async () => {
  const data = Buffer.alloc(2 * 1024 * 1024, 7);
  const blob = new Blob([zip([[prefix + "large.xxx", data, false], [prefix + "Info.plist", binary], [prefix + "BioShock", data, false]])]);
  const ranges = [];
  const instrumented = { size: blob.size, slice(start, end) { ranges.push([start, end]); return blob.slice(start, end); } };
  const ipa = await openIPA(instrumented);
  assert.ok(ranges.reduce((sum, [a, b]) => sum + b - a, 0) < 4096);
  assert.equal(ipa.info.CFBundleDisplayName, "BioShøck");
  assert.deepEqual(ipa.info.Ints, [1, 1234, -1]);
  assert.deepEqual(ipa.info.Flags, [true, false]);
  assert.equal(ipa.info.Pi, 3.125);
  assert.deepEqual([...ipa.info.SampleData], [97, 98, 99, 100]);
});

test("diagnostics index a 1.6 GB virtual IPA by range and report verified executable extraction", async () => {
  const archive = zip([[prefix + "Info.plist", binary], [prefix + "BioShock", Buffer.alloc(9 * 1024 * 1024, 42)]]);
  const tableOffset = archive.readUInt32LE(archive.length - 6);
  const padding = 1_628_682_780 - archive.length;
  archive.writeUInt32LE(tableOffset + padding, archive.length - 6);
  const file = new Blob([archive]);
  const ranges = [];
  // Sparse virtual padding just before the actual directory. Any request for
  // bytes in the padding (or the full archive) fails the test immediately.
  const ipaFile = { size: archive.length + padding, slice(start, end) {
    ranges.push(end - start);
    if (start >= tableOffset + padding) return file.slice(start - padding, end - padding);
    assert.ok(end <= tableOffset);
    return file.slice(start, end);
  } };
  const events = [];
  const ipa = await openIPA(ipaFile, (level, area, message, details) => events.push({ level, area, message, details }));
  assert.ok(ranges.reduce((a, b) => a + b, 0) < 4096);
  assert.equal(events[0].details.archiveBytes, 1_628_682_780);
  assert.equal(events.find(e => e.message === "Reading ZIP central directory").details.entries, 2);
  assert.equal(events.at(-1).details.path, prefix + "BioShock");
  assert.equal((await ipa.readExecutable()).length, 9 * 1024 * 1024);
  const progress = events.filter(e => e.message === "Extraction progress");
  assert.ok(progress.length >= 1 && progress.length <= 3);
  assert.ok(progress.every((e, i) => e.details.bytesRead < e.details.bytes && (!i || e.details.bytesRead > progress[i-1].details.bytesRead)));
  assert.equal(events.at(-1).message, "Executable CRC verified");
  assert.equal(events.at(-1).details.crc32, crc32(Buffer.alloc(9 * 1024 * 1024, 42)).toString(16).padStart(8, "0"));
  assert.ok(events.every(e => e.area === "ipa"));
});

test("diagnostics distinguish invalid archive metadata from corrupt executable data", async () => {
  let last;
  const diagnostic = (level, area, message, details) => { last = { level, area, message, details }; };
  await assert.rejects(openIPA(new Blob([Buffer.from("incomplete")]), diagnostic), /ZIP end record/);
  assert.equal(last.details.stage, "locating ZIP directory");
  assert.equal(last.level, "error");
  const archive = zip([[prefix + "BioShock", "abcd", false], [prefix + "Info.plist", xml]]);
  archive[30 + Buffer.byteLength(prefix + "BioShock")] ^= 1;
  const ipa = await openIPA(new Blob([archive]), diagnostic);
  await assert.rejects(ipa.readExecutable(), /CRC/);
  assert.equal(last.message, "Bundle entry read failed");
  assert.equal(last.details.path, prefix + "BioShock");
  assert.equal(last.details.bytes, 4);
  assert.match(last.details.error, /CRC/);
});

test("rejects corrupt data, traversal, duplicate paths and missing executables", async () => {
  const file = zip([["f", "abc", false]]);
  file[31] ^= 1;
  const archive = await openZip(new Blob([file]));
  await assert.rejects(archive.read("f"), /CRC/);
  for (const path of ["../bad", "/abs", "a\\b"]) {
    await assert.rejects(openZip(new Blob([zip([[path, ""]])])), /Unsafe ZIP path/);
  }
  await assert.rejects(openZip(new Blob([zip([["f",""], ["f",""]])])), /Duplicate ZIP/);
  await assert.rejects(openIPA(new Blob([zip([[prefix + "Info.plist", xml]])])), /Missing app executable/);
  await assert.rejects(openIPA(new Blob([zip([[prefix + "Info.plist", xml], ["Payload/Other.app/Info.plist", xml]])])), /exactly one/);
  assert.throws(() => parsePlist(Buffer.from("<plist><dict><key>A</key></dict></plist>")), /Invalid XML plist/);
});

test("reads a ZIP64 directory and entry offsets", async () => {
  const archive = zip([["f", "abc", false]]);
  const centralStart = archive.readUInt32LE(archive.length - 6);
  const central = Buffer.from(archive.subarray(centralStart, -22));
  central.writeUInt32LE(0xffffffff, 20);
  central.writeUInt32LE(0xffffffff, 24);
  central.writeUInt32LE(0xffffffff, 42);
  central.writeUInt16LE(28, 30);
  const extra = Buffer.alloc(28);
  extra.writeUInt16LE(1, 0);
  extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(3n, 4);
  extra.writeBigUInt64LE(3n, 12);
  const end64 = Buffer.alloc(56);
  end64.writeUInt32LE(0x06064b50);
  end64.writeBigUInt64LE(44n, 4);
  end64.writeBigUInt64LE(1n, 24);
  end64.writeBigUInt64LE(1n, 32);
  end64.writeBigUInt64LE(BigInt(central.length + extra.length), 40);
  end64.writeBigUInt64LE(BigInt(centralStart), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50);
  locator.writeBigUInt64LE(BigInt(centralStart + central.length + extra.length), 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.from(archive.subarray(-22));
  end.fill(0xff, 8, 20);
  const zip64 = new Blob([archive.subarray(0, centralStart), central, extra, end64, locator, end]);
  assert.deepEqual([...(await (await openZip(zip64)).read("f"))], [97, 98, 99]);
});

test("startup ZIP preserves both original compressed members and excludes assets and signatures", async () => {
  const {createStartupZip} = await import("../web/startup-zip.mjs");
  const executable = Buffer.alloc(10 * 1024 * 1024, 0x79);
  const bytes = zip([[prefix + "Info.plist", binary, false], [prefix + "BioShock", executable],
    [prefix + "large.asset", Buffer.alloc(1024 * 1024, 37), false], [prefix + "_CodeSignature/CodeResources", "excluded"]]);
  const original = await openIPA(new Blob([bytes]));
  const exported = await createStartupZip(new Blob([bytes]));
  const archive = await openIPA(exported.blob);
  assert.equal(exported.filename, "BioShock-startup.zip");
  assert.ok(exported.blob.size < 20000);
  assert.deepEqual([...archive.entries.keys()], [prefix + "Info.plist", prefix + "BioShock"]);
  for (const path of archive.entries.keys()) {
    assert.deepEqual(await (await archive.compressedBlob(path)).arrayBuffer(), await (await original.compressedBlob(path)).arrayBuffer());
    assert.equal(archive.entries.get(path).crc, original.entries.get(path).crc);
  }
  assert.deepEqual(Buffer.from(await archive.readExecutable()), executable);
});

test("retains explicit empty ZIP directory names separately from files", async () => {
  const app = await openIPA(new Blob([zip([[prefix + "Info.plist", xml], [prefix + "BioShock", "guest"],
    [prefix + "Unused/", ""], [prefix + "Nested/Empty/", ""]])]));
  assert.equal(app.entries.size, 2);
  assert.deepEqual([...app.directories], [prefix + "Unused", prefix + "Nested/Empty"]);
});

test('random access blobs preserve CRC validation and exact bytes for stored and deflated assets', async () => {
  const bytes = Buffer.from('Content from both ZIP methods');
  const files = [['stored',bytes,false],['deflated',bytes,true]];
  const archive = await openZip(new Blob([zip(files)]));
  for (const [path] of files) {
    const blob = await archive.assetBlob(path);
    assert.deepEqual(Buffer.from(await blob.slice(5,14).arrayBuffer()),bytes.subarray(5,14));
  }
  const damaged = zip(files);
  damaged[30 + Buffer.byteLength('stored')] ^= 255;
  const broken = await openZip(new Blob([damaged]));
  await assert.rejects(broken.assetBlob('stored'),/CRC/);
});
