import type { ApplicationId } from "../domain/application";
const SESSION_LOCK_PREFIX = "retrove.session:";
export async function withApplicationSession<T>(
  id: ApplicationId,
  operation: () => Promise<T>,
  locks: LockManager = navigator.locks,
): Promise<T> {
  if (!locks) throw new Error("This browser cannot safely coordinate app sessions.");
  return locks.request(SESSION_LOCK_PREFIX + id, { ifAvailable: true }, (lock) => {
    if (!lock) throw new Error("Close this app in other windows before continuing.");
    return operation();
  });
}
