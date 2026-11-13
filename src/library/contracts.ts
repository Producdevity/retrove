import type {
  ApplicationId,
  ApplicationMetadata,
  ArchiveReference,
  InstalledApplication,
} from "../domain/application";
export const ImportPhase = {
  Inspecting: "inspecting",
  Storing: "storing",
  Committing: "committing",
  Complete: "complete",
} as const;
export type ImportPhase = (typeof ImportPhase)[keyof typeof ImportPhase];
export interface ImportProgress {
  readonly phase: ImportPhase;
  readonly completedBytes: number;
  readonly totalBytes: number;
}
export type ProgressListener = (progress: ImportProgress) => void;
export interface ApplicationInspector {
  inspect(file: File, signal: AbortSignal): Promise<ApplicationMetadata>;
}
export interface LibraryRepository {
  list(): Promise<InstalledApplication[]>;
  get(id: ApplicationId): Promise<InstalledApplication | undefined>;
  put(app: InstalledApplication): Promise<void>;
  remove(id: ApplicationId): Promise<void>;
}
export interface ArchiveRepository {
  write(
    file: File,
    progress: (bytes: number) => void,
    signal: AbortSignal,
  ): Promise<ArchiveReference>;
  read(reference: ArchiveReference): Promise<Blob>;
  remove(reference: ArchiveReference): Promise<void>;
}
export interface LibraryEnvironment {
  now(): number;
  exclusive<T>(id: ApplicationId, operation: () => Promise<T>): Promise<T>;
  mutateArchive<T>(id: ApplicationId, operation: () => Promise<T>): Promise<T>;
  ensureCapacity(bytes: number): Promise<void>;
  requestPersistence(): Promise<boolean>;
  cleanupFailure(error: unknown): void;
}
