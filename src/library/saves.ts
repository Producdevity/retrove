import { applicationId, Platform, type ApplicationMetadata } from "../domain/application";
import { withApplicationSession } from "../runtime/session-lock";
import { SaveStorage } from "../runtime/storage/save-storage";
import { exportSaves } from "../runtime/storage/backup/snapshot";
import {
  prepareBackup,
  restoreSaves,
  type PreparedBackup,
} from "../runtime/storage/backup/restore";
import { nonnegativeInteger } from "../domain/validation";
const RESTORE_HEADROOM_RATIO = 1.05;
async function withSaves<T>(
  app: ApplicationMetadata,
  operation: (storage: SaveStorage) => Promise<T>,
): Promise<T> {
  if (app.platform !== Platform.IOS)
    throw new Error("Save backup is not available for Android yet.");
  return withApplicationSession(applicationId(app.platform, app.bundleId), async () => {
    const storage = new SaveStorage(app.bundleId);
    try {
      return await operation(storage);
    } finally {
      await storage.close();
    }
  });
}
export function exportApplicationSaves(
  app: ApplicationMetadata,
  signal?: AbortSignal,
): Promise<Blob> {
  return withSaves(app, (storage) => exportSaves(storage, app, signal));
}
export function inspectSaveBackup(
  app: ApplicationMetadata,
  archive: Blob,
  signal?: AbortSignal,
): Promise<PreparedBackup> {
  return prepareBackup(archive, app, signal);
}
export async function restoreApplicationSaves(
  app: ApplicationMetadata,
  backup: PreparedBackup,
  signal?: AbortSignal,
): Promise<void> {
  const source = backup.manifest.app;
  if (applicationId(app.platform, app.bundleId) !== applicationId(source.platform, source.bundleId))
    throw new Error("This backup belongs to a different app.");
  await withSaves(app, async (storage) => {
    const bytes = nonnegativeInteger(backup.bytes, "backup size");
    const { quota, usage } = await navigator.storage.estimate();
    if (
      quota !== undefined &&
      usage !== undefined &&
      quota - usage < bytes * RESTORE_HEADROOM_RATIO
    )
      throw new Error(
        "Not enough browser storage to restore safely. Existing progress is unchanged.",
      );
    await restoreSaves(storage, backup, signal);
  });
}
