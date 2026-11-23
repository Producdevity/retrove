import { parsePlist, type PlistDictionary, type PlistValue } from "../../formats/plist/index";
import { trackedReader } from "./ipa-reader";
import { openZip } from "./zip-archive";
import type { Diagnostic, IpaArchive } from "./zip-types";

export { parsePlist } from "../../formats/plist/index";
export { openZip } from "./zip-archive";
export type { Diagnostic, IpaArchive, ReadOptions, ZipArchive, ZipEntry } from "./zip-types";

const INFO_PATH = /^Payload\/[^/]+\.app\/Info\.plist$/;
const MAX_INFO_BYTES = 0x400000;
const MISSING_APP = "Expected exactly one main .app in the IPA Payload";

function isDictionary(value: PlistValue): value is PlistDictionary {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array)
  );
}

function invalidExecutable(): Error {
  return Error("Invalid CFBundleExecutable in Info.plist");
}

function infoDictionary(info: PlistValue): PlistDictionary {
  if (!isDictionary(info)) throw invalidExecutable();
  return info;
}

function executableName(info: PlistDictionary): string {
  const name = info.CFBundleExecutable;
  if (
    typeof name !== "string" ||
    !name ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name === "." ||
    name === ".."
  ) {
    throw invalidExecutable();
  }
  return name;
}

export async function openIPA(blob: Blob, diagnostic?: Diagnostic): Promise<IpaArchive> {
  let stage = "locating ZIP directory",
    infoPath: string | undefined,
    executablePath: string | undefined;
  diagnostic?.("info", "ipa", "Opening IPA archive", { archiveBytes: blob.size });
  try {
    const zip = await openZip(blob, diagnostic);
    stage = "locating Info.plist";
    diagnostic?.("info", "ipa", "ZIP directory indexed", { files: zip.entries.size });
    for (const path of zip.entries.keys()) {
      if (!INFO_PATH.test(path)) continue;
      if (infoPath) throw Error(MISSING_APP);
      infoPath = path;
    }
    if (!infoPath) throw Error(MISSING_APP);
    const bundlePath = infoPath.slice(0, infoPath.lastIndexOf("/"));
    stage = "reading Info.plist";
    diagnostic?.("info", "ipa", "Reading app metadata", {
      path: infoPath,
      bytes: zip.entries.get(infoPath)?.size,
    });
    const info = infoDictionary(parsePlist(await zip.read(infoPath, { maxBytes: MAX_INFO_BYTES })));
    const name = executableName(info);
    stage = "locating app executable";
    const located = `${bundlePath}/${name}`;
    executablePath = located;
    if (!zip.has(located)) throw Error(`Missing app executable: ${located}`);
    diagnostic?.("info", "ipa", "App executable located", {
      path: located,
      bundleId: info.CFBundleIdentifier,
      version: info.CFBundleShortVersionString,
      build: info.CFBundleVersion,
      minimumOS: info.MinimumOSVersion,
    });
    const read = trackedReader(zip, located, diagnostic);
    return {
      ...zip,
      read,
      bundlePath,
      executablePath: located,
      info,
      readExecutable: () => read(located),
    };
  } catch (error) {
    diagnostic?.("error", "ipa", "Could not open IPA", {
      stage,
      infoPath,
      executablePath,
      error: String(error),
    });
    throw error;
  }
}
