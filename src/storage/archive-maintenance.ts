import type { ArchiveReference } from "../domain/application";
import type { ArchiveRepository, LibraryRepository } from "../library/contracts";
const ARCHIVE_LOCK = "retrove.archives";
export interface ArchiveInventory extends Pick<ArchiveRepository, "remove"> {
  list(): Promise<readonly ArchiveReference[]>;
}
export function withArchiveMutation<T>(
  operation: () => Promise<T>,
  locks: LockManager = navigator.locks,
): Promise<T> {
  if (!locks) throw new Error("This browser cannot safely coordinate archive storage.");
  return locks.request(ARCHIVE_LOCK, { mode: "shared" }, operation);
}
const identity = ({ kind, key }: ArchiveReference): string => JSON.stringify([kind, key]);
export async function collectOrphanArchives(
  library: Pick<LibraryRepository, "list">,
  archives: ArchiveInventory,
  locks: LockManager = navigator.locks,
): Promise<number> {
  if (!locks) return 0;
  return locks.request(ARCHIVE_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) return 0;
    const referenced = new Set((await library.list()).map((app) => identity(app.archive)));
    const inventory = await archives.list();
    const failures: unknown[] = [];
    let removed = 0;
    for (const archive of inventory) {
      if (referenced.has(identity(archive))) continue;
      try {
        await archives.remove(archive);
        removed++;
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "Some unused app archives could not be removed.");
    return removed;
  });
}
