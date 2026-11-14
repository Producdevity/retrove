import { isRecord } from "../domain/validation";
export const GuestStorageKey = {
  Preferences: "bioshock.preferences.",
  Pasteboard: "bioshock.pasteboard.",
  VendorSuffix: ".vendor-id",
} as const;
export function preferenceNamespaces(storage: Storage): string[] {
  const namespaces: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(GuestStorageKey.Preferences)) continue;
    try {
      const value: unknown = JSON.parse(storage.getItem(key) ?? "null");
      if (isRecord(value)) namespaces.push(key.slice(GuestStorageKey.Preferences.length));
    } catch {
      if (!key.endsWith(GuestStorageKey.VendorSuffix))
        namespaces.push(key.slice(GuestStorageKey.Preferences.length));
    }
  }
  return namespaces;
}
export function removeGuestPreferences(
  storage: Storage,
  namespace?: string,
  knownNamespaces: readonly string[] = [],
): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  const names = [
    ...new Set([
      ...knownNamespaces,
      ...preferenceNamespaces(storage),
      ...(namespace ? [namespace] : []),
    ]),
  ].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (!key) continue;
    const preferences = key.startsWith(GuestStorageKey.Preferences),
      pasteboard = key.startsWith(GuestStorageKey.Pasteboard);
    if (!preferences && !pasteboard) continue;
    if (namespace === undefined) {
      storage.removeItem(key);
      continue;
    }
    if (
      preferences &&
      (key === GuestStorageKey.Preferences + namespace ||
        key === GuestStorageKey.Preferences + namespace + GuestStorageKey.VendorSuffix)
    )
      storage.removeItem(key);
    if (
      pasteboard &&
      names.find((name) => key.startsWith(GuestStorageKey.Pasteboard + name + ".")) === namespace
    )
      storage.removeItem(key);
  }
}
