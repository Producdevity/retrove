import type { Diagnostic, ReadOptions, ZipArchive } from "./zip-types";

const LARGE_ENTRY = 0x800000;
const PROGRESS_STEPS = 4;
const HEX = 16;
const CRC_DIGITS = 8;

export function trackedReader(
  zip: ZipArchive,
  executablePath: string,
  diagnostic: Diagnostic | undefined,
): (path: string, options?: ReadOptions) => Promise<Uint8Array<ArrayBuffer>> {
  return async function read(path, options) {
    if (!diagnostic) return zip.read(path, options);
    const entry = zip.entries.get(path);
    const executable = path === executablePath;
    const size = entry?.size;
    const large = size !== undefined && size >= LARGE_ENTRY;
    const tracked = executable || large;
    let bytesRead = 0,
      step = 0;
    const details = {
      path,
      compressedBytes: entry?.compressedSize,
      bytes: entry?.size,
      compressionMethod: entry?.method,
    };
    if (tracked) {
      diagnostic(
        "info",
        "ipa",
        executable ? "Extracting app executable" : "Reading large bundle asset",
        details,
      );
    }
    function recordProgress(offset: number): void {
      bytesRead = offset;
      if (!large || size === undefined) return;
      const next = Math.floor((PROGRESS_STEPS * offset) / size);
      if (next > step && next < PROGRESS_STEPS) {
        step = next;
        diagnostic?.("debug", "ipa", "Extraction progress", { path, bytesRead, bytes: size });
      }
    }
    try {
      const bytes = await zip.read(
        path,
        tracked ? { ...options, onProgress: recordProgress } : options,
      );
      if (tracked) {
        diagnostic(
          "info",
          "ipa",
          executable ? "Executable CRC verified" : "Bundle asset CRC verified",
          {
            path,
            bytes: bytes.length,
            crc32: entry?.crc.toString(HEX).padStart(CRC_DIGITS, "0"),
          },
        );
      }
      return bytes;
    } catch (error) {
      diagnostic("error", "ipa", "Bundle entry read failed", {
        ...details,
        bytesRead: tracked ? bytesRead : undefined,
        error: String(error),
      });
      throw error;
    }
  };
}
