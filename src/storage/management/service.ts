import {
  applicationId,
  Platform,
  type ApplicationId,
  type ArchiveReference,
  type InstalledApplication,
} from "../../domain/application";
import type { LibraryEnvironment } from "../../library/contracts";
import type { LibraryDatabase } from "../library-database";
import type { ArchiveInventory } from "../archive-maintenance";
import { withArchiveMaintenance } from "../archive-maintenance";
import { withStorageUse, withStorageMaintenance } from "../coordination";
import { withIdleApplications } from "../../runtime/session-lock";
import type { SavedAppData, SavedData } from "./saved-data";
interface Archives extends ArchiveInventory {
  read(reference: ArchiveReference): Promise<Blob>;
  clearFiles(): Promise<void>;
}
export interface StorageInventory {
  readonly apps: readonly InstalledApplication[];
  readonly unused: readonly { reference: ArchiveReference; bytes: number }[];
  readonly saved: readonly SavedAppData[];
}
export class StorageManagement {
  constructor(
    private readonly db: Pick<
      LibraryDatabase,
      "get" | "list" | "remove" | "reset" | "applicationKeys" | "archiveReferences"
    >,
    private readonly archives: Archives,
    private readonly saves: SavedData,
    private readonly environment: Pick<LibraryEnvironment, "mutateArchive">,
    private readonly locks: LockManager = navigator.locks,
  ) {}
  private async unused() {
    const identity = (ref: ArchiveReference) => JSON.stringify([ref.kind, ref.key]);
    const referenced = new Set((await this.db.archiveReferences()).map(identity));
    const result: { reference: ArchiveReference; bytes: number }[] = [];
    for (const reference of await this.archives.list())
      if (!referenced.has(identity(reference)))
        result.push({ reference, bytes: (await this.archives.read(reference)).size });
    return result;
  }
  snapshot(): Promise<StorageInventory> {
    return withStorageUse(
      () =>
        withArchiveMaintenance(
          async () => ({
            apps: await this.db.list(),
            unused: await this.unused(),
            saved: await Promise.all(
              (await this.saves.namespaces()).map((name) => this.saves.inspect(name)),
            ),
          }),
          this.locks,
        ),
      this.locks,
    );
  }
  async remove(
    id: ApplicationId,
    includeData: boolean,
    blocked?: (message: string) => void,
  ): Promise<void> {
    await this.environment.mutateArchive(id, async () => {
      const app = await this.db.get(id);
      if (!app) return;
      const namespaces = includeData ? await this.saves.namespaces() : [];
      await this.archives.remove(app.archive);
      if (includeData) await this.saves.remove(app.bundleId, namespaces, blocked);
      await this.db.remove(id);
    });
  }
  removeSaved(namespace: string, blocked?: (message: string) => void): Promise<void> {
    return this.environment.mutateArchive(applicationId(Platform.IOS, namespace), async () =>
      this.saves.remove(namespace, await this.saves.namespaces(), blocked),
    );
  }
  cleanUnused(): Promise<number> {
    return withStorageUse(
      () =>
        withArchiveMaintenance(async () => {
          const unused = await this.unused();
          for (const item of unused) await this.archives.remove(item.reference);
          return unused.length;
        }, this.locks),
      this.locks,
    );
  }
  clear(blocked?: (message: string) => void): Promise<void> {
    return withStorageMaintenance(
      () =>
        withArchiveMaintenance(async () => {
          const namespaces = await this.saves.namespaces();
          const ids: ApplicationId[] = namespaces
            .filter((name) => name.trim() && !name.includes("\0"))
            .map((name) => applicationId(Platform.IOS, name));
          for (const key of await this.db.applicationKeys())
            if (typeof key === "string") {
              for (const platform of Object.values(Platform))
                if (
                  key.startsWith(platform + ":") &&
                  key.length > platform.length + 1 &&
                  !key.includes("\0")
                )
                  ids.push(applicationId(platform, key.slice(platform.length + 1)));
            }
          await withIdleApplications(
            ids,
            async () => {
              await this.archives.clearFiles();
              for (const namespace of namespaces)
                await this.saves.remove(namespace, namespaces, blocked);
              this.saves.clearPreferences();
              await this.db.reset();
            },
            this.locks,
          );
        }, this.locks),
      this.locks,
    );
  }
}
