import { crc32 } from '../src/runtime/formats/crc32.ts';
import { parsePlist } from "./plist.mjs";
export { parsePlist } from "./plist.mjs";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const signature = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50, zip64: 0x06064b50, locator: 0x07064b50 };

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function slice(blob, start, length) {
  if (!Number.isSafeInteger(start) || start < 0 || length < 0 || length > blob.size - start) throw Error("Truncated ZIP");
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

function u64(data, at) {
  const n = Number(data.getBigUint64(at, true));
  if (!Number.isSafeInteger(n)) throw Error("ZIP64 offset exceeds integer precision");
  return n;
}

async function directoryLocation(blob) {
  const minimum = 22;
  if (blob.size < minimum) throw Error("File has no ZIP end record");
  let at = blob.size - minimum;
  let data = view(await slice(blob, at, minimum));
  if (data.getUint32(0, true) !== signature.end || data.getUint16(20, true) !== 0) {
    const start = Math.max(0, at - 65535);
    const tail = await slice(blob, start, blob.size - start);
    const search = view(tail);
    let i = tail.length - minimum;
    while (i >= 0 && !(search.getUint32(i, true) === signature.end &&
           i + minimum + search.getUint16(i + 20, true) === tail.length)) i--;
    if (i < 0) throw Error("File has no valid ZIP end record");
    at = start + i;
    data = view(tail.subarray(i));
  }
  const disk = data.getUint16(4, true), centralDisk = data.getUint16(6, true);
  let localCount = data.getUint16(8, true), count = data.getUint16(10, true);
  let size = data.getUint32(12, true), start = data.getUint32(16, true);
  if (disk || centralDisk) throw Error("Multi-disk ZIPs are unsupported");
  const saturated = size === 0xffffffff || start === 0xffffffff || count === 0xffff || localCount === 0xffff;
  const locator = saturated && at >= 20 ? view(await slice(blob, at - 20, 20)) : null;
  if (locator?.getUint32(0, true) === signature.locator) {
    if (locator.getUint32(4, true) || locator.getUint32(16, true) !== 1) throw Error("Multi-disk ZIP64 is unsupported");
    const zip64At = u64(locator, 8);
    const fields = view(await slice(blob, zip64At, 56));
    if (fields.getUint32(0, true) !== signature.zip64 || fields.getUint32(16, true) || fields.getUint32(20, true)) {
      throw Error("Invalid ZIP64 end record");
    }
    localCount = u64(fields, 24);
    count = u64(fields, 32);
    size = u64(fields, 40);
    start = u64(fields, 48);
    at = zip64At;
  }
  if (localCount !== count || start > at || size > at - start || count > Math.floor(size / 46)) throw Error("Invalid ZIP directory bounds");
  if (size > 64 * 1024 * 1024) throw Error("ZIP directory exceeds 64 MiB");
  return { start, size, count };
}

function applyZip64(entry, extra) {
  const data = view(extra);
  for (let at = 0; at + 4 <= extra.length;) {
    const id = data.getUint16(at, true);
    const size = data.getUint16(at + 2, true);
    at += 4;
    if (size > extra.length - at) throw Error("Invalid ZIP extra field");
    if (id === 1) {
      const fields = view(extra.subarray(at, at + size));
      let position = 0;
      for (const key of ["size", "compressedSize", "offset"]) {
        if (entry[key] !== 0xffffffff) continue;
        entry[key] = u64(fields, position);
        position += 8;
      }
      return;
    }
    at += size;
  }
  throw Error("Missing ZIP64 entry sizes");
}

export async function openZip(blob, diagnostic) {
  const directory = await directoryLocation(blob);
  diagnostic?.("info", "ipa", "Reading ZIP central directory", {
    offset: directory.start, bytes: directory.size, entries: directory.count
  });
  const central = await slice(blob, directory.start, directory.size);
  const data = view(central);
  const entries = new Map(), directories = new Set();
  let at = 0;
  for (let index = 0; index < directory.count; index++) {
    if (at + 46 > central.length || data.getUint32(at, true) !== signature.central) throw Error("Invalid ZIP directory entry");
    const nameLen = data.getUint16(at + 28, true), extraLen = data.getUint16(at + 30, true), commentLen = data.getUint16(at + 32, true);
    const nameAt = at + 46, extraAt = nameAt + nameLen, end = extraAt + extraLen + commentLen;
    if (end > central.length) throw Error("Truncated ZIP directory entry");
    if (data.getUint16(at + 34, true) !== 0) throw Error("Multi-disk ZIP entries are unsupported");
    const rawPath = utf8.decode(central.subarray(nameAt, extraAt));
    const isDir = rawPath.endsWith("/");
    const path = isDir ? rawPath.slice(0, -1) : rawPath;
    const date = data.getUint16(at + 14, true), time = data.getUint16(at + 12, true);
    const modified = date ? Date.UTC(1980 + (date >>> 9), ((date >>> 5) & 15) - 1, date & 31,
      time >>> 11, (time >>> 5) & 63, (time & 31) * 2) : 0;
    const entry = {
      path, modified, flags: data.getUint16(at + 8, true), method: data.getUint16(at + 10, true),
      crc: data.getUint32(at + 16, true), compressedSize: data.getUint32(at + 20, true),
      size: data.getUint32(at + 24, true), offset: data.getUint32(at + 42, true)
    };
    if ([entry.size, entry.compressedSize, entry.offset].includes(0xffffffff)) {
      applyZip64(entry, central.subarray(extraAt, extraAt + extraLen));
    }
    at = end;
    if (path.includes("\\") || path.includes("\0") || path.split("/").some(part => !part || part === "." || part === "..")) {
      throw Error("Unsafe ZIP path: " + path);
    }
    if (entries.has(path) || (!isDir && directories.has(path))) throw Error("Duplicate ZIP path: " + path);
    if (isDir) { directories.add(path); continue; }
    entries.set(path, Object.freeze(entry));
  }

  function entryFor(path) {
    const entry = entries.get(path);
    if (!entry) throw Error("Missing ZIP entry: " + path);
    return entry;
  }

  async function compressedBlob(path) {
    const entry = entryFor(path);
    if (entry.flags & 1) throw Error("Encrypted ZIP entry: " + path);
    if (entry.method !== 0 && entry.method !== 8) throw Error("Unsupported ZIP compression " + entry.method);
    const local = view(await slice(blob, entry.offset, 30));
    if (local.getUint32(0, true) !== signature.local || local.getUint16(8, true) !== entry.method ||
        local.getUint16(6, true) !== entry.flags) throw Error("Invalid ZIP local header: " + path);
    const nameSize = local.getUint16(26, true);
    const start = entry.offset + 30 + nameSize + local.getUint16(28, true);
    if (entry.compressedSize > directory.start - start || (entry.method === 0 && entry.compressedSize !== entry.size)) {
      throw Error("Invalid ZIP payload size: " + path);
    }
    if (utf8.decode(await slice(blob, entry.offset + 30, nameSize)) !== path) throw Error("Mismatched ZIP entry name");
    return blob.slice(start, start + entry.compressedSize);
  }

  async function stream(path) {
    const entry = entryFor(path);
    let input = (await compressedBlob(path)).stream();
    if (entry.method === 8) {
      let inflate;
      try { inflate = new DecompressionStream("deflate-raw"); }
      catch (cause) { throw new Error("This browser could not create a raw DEFLATE decoder for " + path, { cause }); }
      input = input.pipeThrough(inflate);
    }
    let length = 0, crc = 0;
    return input.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        length += chunk.length;
        if (length > entry.size) throw Error("Inflated ZIP entry exceeds its declared size: " + path);
        crc = crc32(crc, chunk);
        controller.enqueue(chunk);
      },
      flush() {
        if (length !== entry.size || crc !== entry.crc) throw Error("Invalid ZIP size or CRC: " + path);
      }
    }));
  }

  async function read(path, { maxBytes = 512 * 1024 * 1024, onProgress } = {}) {
    const entry = entryFor(path);
    if (entry.size > maxBytes) throw Error("ZIP entry exceeds the read limit: " + path);
    const reader = (await stream(path)).getReader();
    let offset = 0;
    try {
      const bytes = new Uint8Array(entry.size);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return bytes;
        bytes.set(value, offset);
        offset += value.length;
        onProgress?.(offset);
      }
    } finally {
      reader.releaseLock();
    }
  }
  async function assetBlob(path) {
    const entry = entryFor(path);
    diagnostic?.('info', 'ipa', 'Opening large asset for random access', {path, bytes: entry.size, method: entry.method});
    const source = await stream(path);
    let result;
    if (entry.method === 0) {
      // Verify once without copying this uncompressed IPA member into the JS heap.
      await source.pipeTo(new WritableStream({write() {}}));
      result = await compressedBlob(path);
    } else {
      result = await new Response(source).blob();
    }
    diagnostic?.('info', 'ipa', 'Bundle asset CRC verified', {path, bytes: result.size, crc32: entry.crc.toString(16).padStart(8,'0')});
    return result;
  }
  return { entries, directories, has: path => entries.has(path), compressedBlob, assetBlob, stream, read };
}

const LARGE_ENTRY = 8 * 1024 * 1024;

export async function openIPA(blob, diagnostic) {
  let stage = "locating ZIP directory", infoPath, executablePath;
  diagnostic?.("info", "ipa", "Opening IPA archive", { archiveBytes: blob.size });
  try {
    const zip = await openZip(blob, diagnostic);
    stage = "locating Info.plist";
    diagnostic?.("info", "ipa", "ZIP directory indexed", { files: zip.entries.size });
    for (const path of zip.entries.keys()) {
      if (!/^Payload\/[^/]+\.app\/Info\.plist$/.test(path)) continue;
      if (infoPath) throw Error("Expected exactly one main .app in the IPA Payload");
      infoPath = path;
    }
    if (!infoPath) throw Error("Expected exactly one main .app in the IPA Payload");
    const bundlePath = infoPath.slice(0, infoPath.lastIndexOf("/"));
    stage = "reading Info.plist";
    diagnostic?.("info", "ipa", "Reading app metadata", { path: infoPath, bytes: zip.entries.get(infoPath).size });
    const info = parsePlist(await zip.read(infoPath, { maxBytes: 4 * 1024 * 1024 }));
    const name = info?.CFBundleExecutable;
    if (typeof name !== "string" || !name || name.includes("/") || name.includes("\\") || name.includes("\0") || name === "." || name === "..") {
      throw Error("Invalid CFBundleExecutable in Info.plist");
    }
    stage = "locating app executable";
    executablePath = bundlePath + "/" + name;
    if (!zip.has(executablePath)) throw Error("Missing app executable: " + executablePath);
    diagnostic?.("info", "ipa", "App executable located", {
      path: executablePath, bundleId: info.CFBundleIdentifier, version: info.CFBundleShortVersionString,
      build: info.CFBundleVersion, minimumOS: info.MinimumOSVersion
    });

    async function read(path, options) {
      if (!diagnostic) return zip.read(path, options);
      const entry = zip.entries.get(path);
      const executable = path === executablePath;
      const large = entry?.size >= LARGE_ENTRY;
      const tracked = executable || large;
      let bytesRead = 0, quarter = 0;
      const details = { path, compressedBytes: entry?.compressedSize, bytes: entry?.size, compressionMethod: entry?.method };
      if (tracked) diagnostic("info", "ipa", executable ? "Extracting app executable" : "Reading large bundle asset", details);
      function recordProgress(offset) {
        bytesRead = offset;
        if (!large) return;
        const next = Math.floor(4 * offset / entry.size);
        if (next > quarter && next < 4) {
          quarter = next;
          diagnostic("debug", "ipa", "Extraction progress", { path, bytesRead, bytes: entry.size });
        }
      }
      try {
        const bytes = await zip.read(path, tracked ? { ...options, onProgress: recordProgress } : options);
        if (tracked) diagnostic("info", "ipa", executable ? "Executable CRC verified" : "Bundle asset CRC verified", {
          path, bytes: bytes.length, crc32: entry.crc.toString(16).padStart(8, "0")
        });
        return bytes;
      } catch (error) {
        diagnostic("error", "ipa", "Bundle entry read failed", {
          ...details, bytesRead: tracked ? bytesRead : undefined, error: String(error)
        });
        throw error;
      }
    }
    return { ...zip, read, bundlePath, executablePath, info, readExecutable: () => read(executablePath) };
  } catch (error) {
    diagnostic?.("error", "ipa", "Could not open IPA", { stage, infoPath, executablePath, error: String(error) });
    throw error;
  }
}
