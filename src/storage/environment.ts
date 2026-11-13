import { DiagnosticOperation, observed } from "../diagnostics/operations";
import type { ApplicationId } from "../domain/application";
import type { LibraryEnvironment } from "../library/contracts";
import { withApplicationSession } from "../runtime/session-lock";
import { withArchiveMutation } from "./archive-maintenance";
const IMPORT_HEADROOM_RATIO = 1.05;
const IMPORT_LOCK_PREFIX = "retrove:library:";

export function browserLibraryEnvironment(
  cleanupFailure: (error: unknown) => void,
): LibraryEnvironment {
  async function exclusive<T>(id: ApplicationId, operation: () => Promise<T>): Promise<T> {
    if (!navigator.locks)
      throw new Error("This browser cannot safely coordinate app storage between tabs.");
    return withArchiveMutation(() => navigator.locks.request(IMPORT_LOCK_PREFIX + id, operation));
  }
  return {
    now: () => Date.now(),
    exclusive,
    mutateArchive: (id, operation) => withApplicationSession(id, () => exclusive(id, operation)),
    async ensureCapacity(bytes: number): Promise<void> {
      const { quota, usage } = await observed(DiagnosticOperation.Capacity, () =>
        navigator.storage.estimate(),
      );
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
