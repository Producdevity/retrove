import { ArchiveKind, type ArchiveReference } from "../domain/application";
import type { ArchiveRepository } from "../library/contracts";
import type { LibraryDatabase } from "./library-database";

const ARCHIVE_DIRECTORY = "retrove-archives";
export class BrowserArchives implements ArchiveRepository {
  constructor(
    private readonly db: LibraryDatabase,
    private readonly storage: StorageManager = navigator.storage,
  ) {}

  private async directory(): Promise<FileSystemDirectoryHandle | undefined> {
    if (!this.storage.getDirectory) return undefined;
    const root = await this.storage.getDirectory();
    return root.getDirectoryHandle(ARCHIVE_DIRECTORY, { create: true });
  }

  async write(
    file: File,
    progress: (bytes: number) => void,
    signal: AbortSignal,
  ): Promise<ArchiveReference> {
    const key = crypto.randomUUID();
    const directory = await this.directory();
    if (!directory) {
      signal.throwIfAborted();
      const reference = await this.db.storeArchive(file, key);
      progress(file.size);
      return reference;
    }
    let completed = 0;
    try {
      const handle = await directory.getFileHandle(key, { create: true });
      const destination = await handle.createWritable();
      await file
        .stream()
        .pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              completed += chunk.byteLength;
              progress(completed);
              controller.enqueue(chunk);
            },
          }),
        )
        .pipeTo(destination, { signal });
      if (completed !== file.size) throw new Error("The imported archive was incomplete.");
      return { kind: ArchiveKind.FileSystem, key };
    } catch (error) {
      try {
        await directory.removeEntry(key);
      } catch (cleanupError) {
        if (!(cleanupError instanceof DOMException) || cleanupError.name !== "NotFoundError") {
          throw new AggregateError(
            [error, cleanupError],
            "Import failed and its partial archive could not be removed.",
          );
        }
      }
      throw error;
    }
  }

  async read(reference: ArchiveReference): Promise<Blob> {
    if (reference.kind === ArchiveKind.Database) return this.db.archive(reference.key);
    const directory = await this.directory();
    if (!directory) throw new Error("File storage is unavailable in this browser.");
    return (await directory.getFileHandle(reference.key)).getFile();
  }

  async remove(reference: ArchiveReference): Promise<void> {
    if (reference.kind === ArchiveKind.Database) return this.db.removeArchive(reference.key);
    const directory = await this.directory();
    if (!directory) throw new Error("File storage is unavailable in this browser.");
    await directory.removeEntry(reference.key);
  }
}
