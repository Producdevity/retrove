import { Mode } from "../../libc/files/constants";
import { Argument } from "../../objc/host";
import type { HostFiles } from "./host-files";

export function installDirectoryMethods(files: HostFiles): void {
  const { host } = files;
  const { method, send, heap } = host;
  method("NSFileManager", false, "createDirectoryAtPath:attributes:", (self, a) =>
    send(self, "createDirectoryAtPath:withIntermediateDirectories:attributes:error:", [
      a(0),
      0,
      a(1),
      0,
    ]),
  );
  method(
    "NSFileManager",
    false,
    "createDirectoryAtPath:withIntermediateDirectories:attributes:error:",
    async (self, a) => {
      const path = host.text(a(0)),
        parents = a(1),
        attributes = a(Argument.Third),
        error = a(Argument.Fourth),
        segments = path.split("/").filter(Boolean);
      const prefix = path.startsWith("/") ? "/" : "";
      for (let i = parents ? 1 : segments.length; i <= segments.length; i++) {
        const target = prefix + segments.slice(0, i).join("/");
        const pointer = heap.string(target);
        try {
          const created = (await files.invoke("_mkdir", pointer, Mode.DirectoryDefault)) === 0;
          if (!created && !(parents && files.isDirectory(await files.stat(pointer, 0))))
            return files.failure(error);
          if (
            created &&
            attributes &&
            !(await send(self, "setAttributes:ofItemAtPath:error:", [
              attributes,
              host.string(target),
              error,
            ]))
          )
            return 0;
        } finally {
          heap.free(pointer);
        }
      }
      return 1;
    },
  );
  method("NSFileManager", false, "contentsOfDirectoryAtPath:error:", async (_, a) => {
    const names = await files.listNames(host.utf8(a(0)));
    if (!names) return files.failure(a(1));
    return host.autorelease(host.array(names.map((name) => host.string(name))));
  });
}
