export const Platform = { IOS: "ios", Android: "android" } as const;
export type Platform = (typeof Platform)[keyof typeof Platform];
export type ApplicationId = `${Platform}:${string}`;

export const ArchiveKind = { FileSystem: "opfs", Database: "indexeddb" } as const;
export type ArchiveKind = (typeof ArchiveKind)[keyof typeof ArchiveKind];
export interface ArchiveReference {
  readonly kind: ArchiveKind;
  readonly key: string;
}
export interface ApplicationMetadata {
  readonly platform: Platform;
  readonly bundleId: string;
  readonly name: string;
  readonly version: string;
  readonly icon: Blob | null;
}
export interface InstalledApplication extends ApplicationMetadata {
  readonly id: ApplicationId;
  readonly archive: ArchiveReference;
  readonly sourceName: string;
  readonly size: number;
  readonly importedAt: number;
  readonly lastPlayedAt: number | null;
}
export function applicationId(platform: Platform, bundleId: string): ApplicationId {
  if (!bundleId.trim() || bundleId.includes("\0"))
    throw new Error("The app has no valid identifier.");
  return `${platform}:${bundleId}`;
}
export function isPlatform(value: unknown): value is Platform {
  return value === Platform.IOS || value === Platform.Android;
}
