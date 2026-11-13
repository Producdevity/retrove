import {
  applicationId,
  ArchiveKind,
  isPlatform,
  type InstalledApplication,
} from "../domain/application";
import { isRecord, nonnegativeInteger, requiredString } from "../domain/validation";

export function decodeApplication(value: unknown): InstalledApplication {
  if (!isRecord(value) || !isPlatform(value.platform) || !isRecord(value.archive)) {
    throw new Error("The saved app record is invalid.");
  }
  const kind = value.archive.kind;
  if (kind !== ArchiveKind.FileSystem && kind !== ArchiveKind.Database)
    throw new Error("Unknown archive storage.");
  const bundleId = requiredString(value.bundleId, "app identifier");
  const id = applicationId(value.platform, bundleId);
  if (value.id !== id) throw new Error("The saved app identity does not match.");
  if (value.icon !== null && !(value.icon instanceof Blob)) throw new Error("Invalid app icon.");
  if (typeof value.version !== "string") throw new Error("Invalid app version.");
  return {
    id,
    platform: value.platform,
    bundleId,
    name: requiredString(value.name, "app name"),
    version: value.version,
    icon: value.icon,
    archive: { kind, key: requiredString(value.archive.key, "archive key") },
    sourceName: requiredString(value.sourceName, "source filename"),
    size: nonnegativeInteger(value.size, "archive size"),
    importedAt: nonnegativeInteger(value.importedAt, "import time"),
    lastPlayedAt:
      value.lastPlayedAt === null
        ? null
        : nonnegativeInteger(value.lastPlayedAt, "last played time"),
  };
}
