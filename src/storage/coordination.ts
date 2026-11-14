const STORAGE_LOCK = "retrove.storage";
export function withStorageUse<T>(
  operation: () => Promise<T>,
  locks: LockManager = navigator.locks,
): Promise<T> {
  if (!locks) throw new Error("This browser cannot safely coordinate app storage.");
  return locks.request(STORAGE_LOCK, { mode: "shared" }, operation);
}
export function withStorageMaintenance<T>(
  operation: () => Promise<T>,
  locks: LockManager = navigator.locks,
): Promise<T> {
  if (!locks) throw new Error("This browser cannot safely coordinate app storage.");
  return locks.request(STORAGE_LOCK, { ifAvailable: true }, (lock) => {
    if (!lock) throw new Error("Close running apps and finish imports before managing storage.");
    return operation();
  });
}
