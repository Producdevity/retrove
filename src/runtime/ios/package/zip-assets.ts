import { InflatedAssets } from "../../../storage/inflated-assets";
import { Method, type PayloadReaders } from "./zip-payload";
import type { Diagnostic, ZipEntry } from "./zip-types";

const HEX = 16;
const CRC_DIGITS = 8;

export function assetReader(
  blob: Blob,
  readers: PayloadReaders,
  diagnostic: Diagnostic | undefined,
): (path: string) => Promise<Blob> {
  const { entryFor, stream, compressedBlob } = readers;
  const inflated = InflatedAssets.for(blob);
  // Large deflated members are inflated once to disk; holding them in memory exhausts iOS Safari.
  async function storedAsset(path: string, entry: ZipEntry): Promise<Blob | undefined> {
    if (entry.method !== Method.Deflate || !inflated) return undefined;
    try {
      const stored = await inflated.blob(
        { path, size: entry.size, crc: entry.crc },
        () => stream(path),
        () =>
          diagnostic?.("info", "ipa", "Storing inflated asset on disk", {
            path,
            bytes: entry.size,
          }),
      );
      if (stored) {
        diagnostic?.("info", "ipa", "Opened stored asset for random access", {
          path,
          bytes: stored.size,
        });
      }
      return stored;
    } catch (error) {
      diagnostic?.("warn", "ipa", "Could not store inflated asset; keeping it in memory", {
        path,
        error: String(error),
      });
      return undefined;
    }
  }
  return async function assetBlob(path) {
    const entry = entryFor(path);
    const stored = await storedAsset(path, entry);
    if (stored) return stored;
    diagnostic?.("info", "ipa", "Opening large asset for random access", {
      path,
      bytes: entry.size,
      method: entry.method,
    });
    const source = await stream(path);
    let result: Blob;
    if (entry.method === Method.Stored) {
      // Verify once without copying this uncompressed IPA member into the JS heap.
      await source.pipeTo(new WritableStream({ write: () => undefined }));
      result = await compressedBlob(path);
    } else {
      result = await new Response(source).blob();
    }
    diagnostic?.("info", "ipa", "Bundle asset CRC verified", {
      path,
      bytes: result.size,
      crc32: entry.crc.toString(HEX).padStart(CRC_DIGITS, "0"),
    });
    return result;
  };
}
