import { Errno, raise } from "./errno";
import { SAVE_ROOTS } from "./constants";
import type { BundleArchive, Located } from "./types";

export function parentPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

export function isBundlePath(ipa: BundleArchive, path: string): boolean {
  return path === ipa.bundlePath || path.startsWith(`${ipa.bundlePath}/`);
}

function absolute(raw: string, ipa: BundleArchive, current: string, bundleDirectory: string) {
  const first = raw.split("/", 1)[0] ?? "";
  if (raw.startsWith("/")) return raw;
  if (raw.startsWith("~/")) return raw.slice(1);
  if (isBundlePath(ipa, raw) || (current === bundleDirectory && SAVE_ROOTS.has(first)))
    return `/${raw}`;
  return `${current}/${raw}`;
}

/** Resolves a guest path against the bundle, the save roots and the current directory. */
export function resolvePath(
  raw: string,
  ipa: BundleArchive,
  current: string,
  bundleDirectory: string,
): Located {
  if (!raw) raise(Errno.NoEntry);
  if (raw.includes("\\")) raise(Errno.Access);
  const parts: string[] = [];
  for (const part of absolute(raw, ipa, current, bundleDirectory).split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  // The folder holding the .app is the app's home, so `<bundle>/../Documents` is Documents.
  const container = ipa.bundlePath.slice(0, ipa.bundlePath.lastIndexOf("/"));
  if (container && parts[0] === container && SAVE_ROOTS.has(parts[1] ?? "")) parts.shift();
  const path = parts.join("/");
  if (!path || SAVE_ROOTS.has(parts[0] ?? "")) return { home: path };
  if (isBundlePath(ipa, path)) return { bundle: path };
  return raise(Errno.Access);
}
