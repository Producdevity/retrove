export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Storage request failed."));
  });
}

export async function transaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(stores, mode, { durability: "strict" });
  const finished = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () =>
      reject(tx.error ?? new Error("The storage transaction was interrupted."));
  });
  const completion = finished.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    const result = await operation(tx);
    const outcome = await completion;
    if (!outcome.ok) throw outcome.error;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch (abortError) {
      if (!(abortError instanceof DOMException) || abortError.name !== "InvalidStateError")
        throw abortError;
    }
    await completion;
    throw error;
  }
}
