import {
  applicationId,
  type ApplicationId,
  type InstalledApplication,
} from "../domain/application";
import {
  ImportPhase,
  type ApplicationInspector,
  type ArchiveRepository,
  type LibraryEnvironment,
  type LibraryRepository,
  type ProgressListener,
} from "./contracts";

export class ApplicationLibrary {
  constructor(
    private readonly records: LibraryRepository,
    private readonly archives: ArchiveRepository,
    private readonly inspector: ApplicationInspector,
    private readonly environment: LibraryEnvironment,
  ) {}

  list(): Promise<InstalledApplication[]> {
    return this.records.list();
  }
  get(id: ApplicationId): Promise<InstalledApplication | undefined> {
    return this.records.get(id);
  }
  open(app: InstalledApplication): Promise<Blob> {
    return this.archives.read(app.archive);
  }

  async import(
    file: File,
    signal: AbortSignal,
    progress: ProgressListener,
  ): Promise<InstalledApplication> {
    const report = (phase: ImportPhase, completedBytes: number): void =>
      progress({ phase, completedBytes, totalBytes: file.size });
    signal.throwIfAborted();
    report(ImportPhase.Inspecting, 0);
    const metadata = await this.inspector.inspect(file, signal);
    const id = applicationId(metadata.platform, metadata.bundleId);
    return this.environment.mutateArchive(id, async () => {
      signal.throwIfAborted();
      const previous = await this.records.get(id);
      await this.environment.ensureCapacity(file.size);
      report(ImportPhase.Storing, 0);
      const archive = await this.archives.write(
        file,
        (bytes) => report(ImportPhase.Storing, bytes),
        signal,
      );
      const app: InstalledApplication = {
        ...metadata,
        id,
        archive,
        sourceName: file.name,
        size: file.size,
        importedAt: this.environment.now(),
        lastPlayedAt: previous?.lastPlayedAt ?? null,
      };
      try {
        signal.throwIfAborted();
        report(ImportPhase.Committing, file.size);
        await this.records.put(app);
      } catch (error) {
        await this.removeArchive(archive);
        throw error;
      }
      if (previous) await this.removeArchive(previous.archive);
      try {
        await this.environment.requestPersistence();
      } catch (error) {
        this.environment.cleanupFailure(error);
      }
      report(ImportPhase.Complete, file.size);
      return app;
    });
  }

  async remove(id: ApplicationId): Promise<void> {
    await this.environment.mutateArchive(id, async () => {
      const app = await this.records.get(id);
      if (!app) return;
      await this.records.remove(id);
      await this.removeArchive(app.archive);
    });
  }

  async played(id: ApplicationId): Promise<void> {
    await this.environment.exclusive(id, async () => {
      const app = await this.records.get(id);
      if (app) await this.records.put({ ...app, lastPlayedAt: this.environment.now() });
    });
  }

  private async removeArchive(reference: InstalledApplication["archive"]): Promise<void> {
    try {
      await this.archives.remove(reference);
    } catch (error) {
      this.environment.cleanupFailure(error);
    }
  }
}
