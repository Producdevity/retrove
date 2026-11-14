import { withStorageUse } from "../storage/coordination";
import type { ApplicationId } from "../domain/application";
const SESSION_LOCK_PREFIX = "retrove.session:";
export async function withApplicationSession<T>(
  id: ApplicationId,
  operation: () => Promise<T>,
  locks: LockManager = navigator.locks,
): Promise<T> {
  if (!locks) throw new Error("This browser cannot safely coordinate app sessions.");
  return withStorageUse(
    () =>
      locks.request(SESSION_LOCK_PREFIX + id, { ifAvailable: true }, (lock) => {
        if (!lock) throw new Error("Close this app in other windows before continuing.");
        return operation();
      }),
    locks,
  );
}

export function withIdleApplications<T>(
  ids: readonly ApplicationId[],
  operation: () => Promise<T>,
  locks: LockManager = navigator.locks,
): Promise<T> {
  const sorted = [...new Set(ids)].sort();
  const acquire = (index: number): Promise<T> => {
    const id = sorted[index];
    if (id === undefined) return operation();
    return locks.request(SESSION_LOCK_PREFIX + id, { ifAvailable: true }, (lock) => {
      if (!lock) throw new Error("Close running apps in other Retrove windows before continuing.");
      return acquire(index + 1);
    });
  };
  return acquire(0);
}
