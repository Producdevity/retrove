export const ARCHIVE_DIRECTORY = "retrove-archives";
export const OWNED_ARCHIVE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSETS_SUFFIX = ".assets";
const HEX = 16;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export interface ArchiveEntry {
  readonly path: string;
  readonly size: number;
  readonly crc: number;
}
/** The parts of the origin private file system this cache uses. */
export interface AssetFile {
  getFile(): Promise<File>;
  createWritable?(): Promise<WritableStream<Uint8Array>>;
}
export interface AssetDirectory {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<AssetDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<AssetFile>;
  removeEntry(name: string): Promise<void>;
}
interface StorageRoot {
  getDirectory(): Promise<AssetDirectory>;
}

export function assetDirectoryName(archiveKey: string): string {
  return archiveKey + ASSETS_SUFFIX;
}
/** Content-addressed name: CRC-32, size and a hash of the bundle path. */
export function inflatedAssetName(entry: ArchiveEntry): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(entry.path))
    hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
  return [entry.crc >>> 0, entry.size, hash].map((value) => value.toString(HEX)).join("-");
}

/**
 * Keeps inflated copies of large compressed IPA members on disk beside their archive, so the
 * runtime reads them through file-backed Blobs instead of holding them in memory.
 */
export class InflatedAssets {
  readonly #pending = new Map<string, Promise<Blob | undefined>>();
  private constructor(
    private readonly storage: StorageRoot,
    private readonly archiveKey: string,
  ) {}
  /** Only archives imported into the origin private file system have a place for inflated copies. */
  static for(
    archive: Blob,
    storage: Partial<StorageRoot> | undefined = globalThis.navigator?.storage,
  ) {
    if (!(archive instanceof File) || !OWNED_ARCHIVE.test(archive.name)) return undefined;
    const getDirectory = storage?.getDirectory?.bind(storage);
    return getDirectory ? new InflatedAssets({ getDirectory }, archive.name) : undefined;
  }
  private async directory(): Promise<AssetDirectory> {
    const root = await this.storage.getDirectory();
    const archives = await root.getDirectoryHandle(ARCHIVE_DIRECTORY, { create: true });
    return archives.getDirectoryHandle(assetDirectoryName(this.archiveKey), { create: true });
  }
  /** The stored copy; `inflate` streams verified contents on the first use. Undefined when unavailable. */
  blob(
    entry: ArchiveEntry,
    inflate: () => Promise<ReadableStream<Uint8Array>>,
    onStore?: () => void,
  ): Promise<Blob | undefined> {
    const name = inflatedAssetName(entry);
    let pending = this.#pending.get(name);
    if (!pending) {
      pending = this.load(name, entry.size, inflate, onStore).finally(() =>
        this.#pending.delete(name),
      );
      this.#pending.set(name, pending);
    }
    return pending;
  }
  private async load(
    name: string,
    size: number,
    inflate: () => Promise<ReadableStream<Uint8Array>>,
    onStore?: () => void,
  ): Promise<Blob | undefined> {
    const directory = await this.directory();
    try {
      const existing = await (await directory.getFileHandle(name)).getFile();
      if (existing.size === size) return existing;
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
    }
    const handle = await directory.getFileHandle(name, { create: true });
    if (typeof handle.createWritable !== "function") return undefined;
    onStore?.();
    try {
      await (await inflate()).pipeTo(await handle.createWritable());
    } catch (error) {
      await directory.removeEntry(name).catch(() => undefined);
      if (error instanceof DOMException && error.name === "QuotaExceededError") return undefined;
      throw error;
    }
    const stored = await handle.getFile();
    if (stored.size !== size) throw new Error(`Stored asset ${name} is incomplete.`);
    return stored;
  }
}
