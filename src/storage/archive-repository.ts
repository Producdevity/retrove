import { DiagnosticOperation, observed } from "../diagnostics/operations";
import { ArchiveKind, type ArchiveReference } from "../domain/application";
import type { ArchiveRepository } from "../library/contracts";
import type { LibraryDatabase } from "./library-database";

import type { ArchiveInventory } from "./archive-maintenance";
const OWNED_ARCHIVE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARCHIVE_DIRECTORY = "retrove-archives";
export class BrowserArchives implements ArchiveRepository, ArchiveInventory {
  constructor(
    private readonly db: LibraryDatabase,
    private readonly storage: StorageManager = navigator.storage,
  ) {}

  private async directory(): Promise<FileSystemDirectoryHandle | undefined> {
    if (!this.storage.getDirectory) return undefined;
    return observed(DiagnosticOperation.FileStorage, async () => {
      const root = await this.storage.getDirectory();
      return root.getDirectoryHandle(ARCHIVE_DIRECTORY, { create: true });
    });
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
      const handle = await observed(DiagnosticOperation.CreateArchive, () =>
        directory.getFileHandle(key, { create: true }),
      );
      const destination = await observed(DiagnosticOperation.WritableArchive, () =>
        handle.createWritable(),
      );
      await observed(DiagnosticOperation.WriteArchive, () =>
        file
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
          .pipeTo(destination, { signal }),
      );
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

  async list(): Promise<ArchiveReference[]> {
    const archives: ArchiveReference[] = (await this.db.archiveKeys())
      .filter((key) => OWNED_ARCHIVE.test(key))
      .map((key) => ({ kind: ArchiveKind.Database, key }));
    const directory = await this.directory();
    if (directory)
      for await (const [key, handle] of directory.entries())
        if (handle.kind === "file" && OWNED_ARCHIVE.test(key))
          archives.push({ kind: ArchiveKind.FileSystem, key });
    return archives;
  }

  async clearFiles(): Promise<void> {
    if (!this.storage.getDirectory) return;
    const root = await this.storage.getDirectory();
    try {
      await root.removeEntry(ARCHIVE_DIRECTORY, { recursive: true });
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
    }
  }
  async remove(reference: ArchiveReference): Promise<void> {
    if (reference.kind === ArchiveKind.Database) return this.db.removeArchive(reference.key);
    const directory = await this.directory();
    if (!directory) throw new Error("File storage is unavailable in this browser.");
    try {
      await directory.removeEntry(reference.key);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
    }
  }
}
