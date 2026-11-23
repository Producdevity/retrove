import type { Diagnostic, IpaArchive } from "../../package/ipa";
import { SaveStorage } from "../../../storage/save-storage";
import { SAVE_CHUNK_BYTES } from "../../../storage/records";
import type { SaveStores } from "../../../storage/stores";

const BUNDLE_IDENTIFIER = "com.hip.180282";
const TARGET = "Documents/BioshockConfig";

async function publish(
  { paths, inodes, chunks }: SaveStores,
  config: readonly (readonly [string, Uint8Array])[],
): Promise<void> {
  // Another tab may have completed installation during extraction.
  if (await paths.get(TARGET)) return;
  const dirs = new Set([TARGET]);
  for (const [name, data] of config) {
    for (let i = name.indexOf("/", TARGET.length + 1); i !== -1; i = name.indexOf("/", i + 1)) {
      dirs.add(name.slice(0, i));
    }
    const inode = await inodes.add({ size: data.byteLength, refs: 0, linked: true });
    await paths.put(name, { inode });
    for (let offset = 0; offset < data.length; offset += SAVE_CHUNK_BYTES) {
      const part = data.subarray(offset, offset + SAVE_CHUNK_BYTES);
      // Writable file chunks have a fixed size; later writes can extend the last chunk.
      const block = new Uint8Array(SAVE_CHUNK_BYTES);
      block.set(part);
      await chunks.put([inode, offset / SAVE_CHUNK_BYTES], block);
    }
  }
  for (const dir of dirs) await paths.put(dir, { dir: true });
}

// The native port prepares Documents/BioshockConfig before running game constructors.
export async function prepareBioShockConfig(
  ipa: IpaArchive,
  diagnostic: Diagnostic,
  storage?: SaveStorage,
): Promise<void> {
  const identifier = ipa.info?.CFBundleIdentifier;
  if (identifier !== BUNDLE_IDENTIFIER || !ipa.entries) return;
  const source = `${ipa.bundlePath}/BioshockConfig/`;
  const entries = [...ipa.entries.keys()].filter((path) => path.startsWith(source));
  if (!entries.length) return; // Executable-only startup archives omit game assets.

  const own = !storage;
  const target = storage ?? new SaveStorage(identifier);
  try {
    if (await target.run("readonly", ({ paths }) => paths.get(TARGET))) return;
    diagnostic("info", "files", "Preparing writable BioShock configuration", {
      files: entries.length,
    });
    // Blob reads cannot run inside an IndexedDB transaction. Stage the small
    // settings files first, then publish the complete directory atomically.
    const config: [string, Uint8Array][] = [];
    for (const path of entries)
      config.push([`${TARGET}/${path.slice(source.length)}`, await ipa.read(path)]);
    await target.run("readwrite", (stores) => publish(stores, config));
  } finally {
    if (own) await target.close();
  }
}
