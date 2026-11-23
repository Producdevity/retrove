import { readString } from "../../../memory/guest-memory";
import type { HostFiles } from "./host-files";

const SearchDirectory = { Library: 5, Documents: 9, Caches: 13, ApplicationSupport: 14 } as const;
const USER_DOMAIN = 1;
const DIRECTORIES = new Map<number, string>([
  [SearchDirectory.Library, "/Library"],
  [SearchDirectory.Documents, "/Documents"],
  [SearchDirectory.Caches, "/Library/Caches"],
  [SearchDirectory.ApplicationSupport, "/Library/Application Support"],
]);

export function installPathMethods(files: HostFiles): void {
  const { host } = files;
  const { method, string } = host;
  method("NSFileManager", false, "URLsForDirectory:inDomains:", async (_, a) => {
    const path = DIRECTORIES.get(a(0));
    const urls =
      a(1) & USER_DOMAIN && path
        ? [await files.sendNumber(files.className("NSURL"), "fileURLWithPath:", [string(path)])]
        : [];
    return host.autorelease(host.array(urls));
  });
  method("NSFileManager", false, "fileExistsAtPath:", async (_, a) =>
    Number(Boolean(a(0) && (await files.stat(host.utf8(a(0)), 0)))),
  );
  method("NSFileManager", false, "fileExistsAtPath:isDirectory:", async (_, a) =>
    Number(Boolean(a(0) && (await files.stat(host.utf8(a(0)), a(1))))),
  );
  method("NSFileManager", false, "currentDirectoryPath", async () => {
    const path = await files.invoke("_getcwd", 0, 0);
    try {
      return path ? string(readString(host.cpu, path)) : 0;
    } finally {
      if (path) host.heap.free(path);
    }
  });
  method("NSFileManager", false, "changeCurrentDirectoryPath:", async (_, a) =>
    Number(Boolean(a(0)) && (await files.invoke("_chdir", host.utf8(a(0)))) === 0),
  );
}
