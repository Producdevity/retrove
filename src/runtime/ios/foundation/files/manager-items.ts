import { Argument } from "../../objc/host";
import { FileOpen, IO_CHUNK_BYTES, type HostFiles } from "./host-files";
import { copyTree, removeTree } from "./tree";

const DATA_POINTER_OFFSET = 4;
const DATA_LENGTH_OFFSET = 8;
const TRAILING_SLASHES = /\/+$/u;

export function installItemMethods(files: HostFiles): void {
  const { host } = files;
  const { method, send } = host;
  method("NSFileManager", false, "removeItemAtURL:error:", async (self, a) => {
    const url = a(0),
      error = a(1);
    if (!url || !(await send(url, "isFileURL"))) return files.failure(error);
    return send(files.manager ?? self, "removeItemAtPath:error:", [
      await files.sendNumber(url, "path"),
      error,
    ]);
  });
  method("NSFileManager", false, "removeItemAtPath:error:", async (_, a) =>
    (await removeTree(files, host.text(a(0)))) ? 1 : files.failure(a(1)),
  );
  method("NSFileManager", false, "copyItemAtPath:toPath:error:", async (_, a) => {
    const source = host.text(a(0)).replace(TRAILING_SLASHES, ""),
      dest = host.text(a(1)).replace(TRAILING_SLASHES, ""),
      error = a(Argument.Third);
    if (dest === source || dest.startsWith(`${source}/`)) return files.failure(error);
    return (await copyTree(files, source, dest)) ? 1 : files.failure(error);
  });
  method("NSFileManager", false, "contentsAtPath:", (_, a) =>
    send(files.className("NSData"), "dataWithContentsOfFile:", [a(0)]),
  );
  method("NSFileManager", false, "createFileAtPath:contents:attributes:", async (_, a) => {
    const data = a(1),
      descriptor = await files.invoke("_open", host.utf8(a(0)), FileOpen.WriteTruncate);
    if (descriptor < 0) return 0;
    try {
      if (!data) return 1;
      const size = host.read(data + DATA_LENGTH_OFFSET),
        pointer = host.read(data + DATA_POINTER_OFFSET);
      for (let offset = 0; offset < size;) {
        const count = await files.invoke(
          "_write",
          descriptor,
          pointer + offset,
          Math.min(IO_CHUNK_BYTES, size - offset),
        );
        if (count <= 0) return 0;
        offset += count;
      }
      return 1;
    } finally {
      await files.invoke("_close", descriptor);
    }
  });
  method("NSFileManager", false, "stringWithFileSystemRepresentation:length:", (_, a) =>
    host.string(new TextDecoder().decode(host.cpu.read(a(0), a(1)))),
  );
}
