export const DiagnosticOperation = {
  Session: "library-session",
  Refresh: "read-library",
  Maintenance: "archive-maintenance",
  Capacity: "check-storage-capacity",
  FileStorage: "open-file-storage",
  CreateArchive: "create-archive-file",
  WritableArchive: "open-archive-writer",
  WriteArchive: "write-archive",
  ReadArchive: "read-archive",
  Database: "open-library-database",
  InspectPackage: "read-ipa-package",
  InspectExecutable: "inspect-ipa-executable",
  Import: "import-app",
  ImportProgress: "import-progress",
  Settings: "read-storage-settings",
  Offline: "register-offline-shell",
  Interface: "library-interface",
} as const;
export type DiagnosticOperation = (typeof DiagnosticOperation)[keyof typeof DiagnosticOperation];

export class OperationError extends Error {
  constructor(
    readonly operation: DiagnosticOperation,
    cause: unknown,
  ) {
    super(`${operation}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "OperationError";
  }
}
export async function observed<T>(
  operation: DiagnosticOperation,
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (cause) {
    throw new OperationError(operation, cause);
  }
}

export function failedOperation(error: unknown, operation: DiagnosticOperation): boolean {
  const seen = new Set<unknown>();
  for (
    let cause: unknown = error;
    cause instanceof Error && !seen.has(cause);
    cause = cause.cause
  ) {
    seen.add(cause);
    if (cause instanceof OperationError && cause.operation === operation) return true;
  }
  return false;
}
