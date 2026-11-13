import type { ApplicationId } from "../domain/application";
import type { LibraryEnvironment } from "../library/contracts";
const IMPORT_HEADROOM_RATIO = 1.05;
const IMPORT_LOCK_PREFIX = "retrove:library:";

export function browserLibraryEnvironment(
  cleanupFailure: (error: unknown) => void,
): LibraryEnvironment {
  return {
    now: () => Date.now(),
    async exclusive<T>(id: ApplicationId, operation: () => Promise<T>): Promise<T> {
      if (!navigator.locks)
        throw new Error("This browser cannot safely coordinate app storage between tabs.");
      return navigator.locks.request(IMPORT_LOCK_PREFIX + id, operation);
    },
    async ensureCapacity(bytes: number): Promise<void> {
      const { quota, usage } = await navigator.storage.estimate();
      if (
        quota !== undefined &&
        usage !== undefined &&
        quota - usage < bytes * IMPORT_HEADROOM_RATIO
      ) {
        throw new Error(
          "Not enough browser storage to keep this app. Free space before importing.",
        );
      }
    },
    requestPersistence: () => navigator.storage.persist(),
    cleanupFailure,
  };
}
