import { Argument } from "../../objc/host";
import { writeArchiveFile } from "../archives/file-writer";
import type { HostFiles } from "./host-files";

const DATA_POINTER_OFFSET = 4;
const DATA_LENGTH_OFFSET = 8;

export function archiveWriter(files: HostFiles): Parameters<typeof writeArchiveFile>[0] {
  const { heap, cpu } = files.host;
  return {
    unique: () => crypto.randomUUID(),
    open: (path, flags) => files.pathCall(path, (pointer) => files.invoke("_open", pointer, flags)),
    close: (descriptor) => files.invoke("_close", descriptor),
    rename: (source, dest) =>
      files.pathCall(source, (from) =>
        files.pathCall(dest, (to) => files.invoke("_rename", from, to)),
      ),
    remove: (path) => files.pathCall(path, (pointer) => files.invoke("_unlink", pointer)),
    async write(descriptor, bytes) {
      const pointer = heap.alloc(bytes.length);
      try {
        cpu.write(pointer, bytes);
        return await files.invoke("_write", descriptor, pointer, bytes.length);
      } finally {
        heap.free(pointer);
      }
    },
  };
}

/** NSData writes go through a temporary file and rename, which also satisfies non-atomic writes. */
export function installDataWrites(
  files: HostFiles,
  writer: ReturnType<typeof archiveWriter>,
): void {
  const { host } = files;
  const { method, send } = host;
  const write = async (self: number, path: number): Promise<boolean> =>
    Boolean(path) &&
    (await writeArchiveFile(
      writer,
      host.text(path),
      host.cpu.read(host.read(self + DATA_POINTER_OFFSET), host.read(self + DATA_LENGTH_OFFSET)),
    ));
  method("NSData", false, "writeToFile:atomically:", async (self, a) =>
    Number(await write(self, a(0))),
  );
  method("NSData", false, "writeToFile:options:error:", async (self, a) =>
    (await write(self, a(0))) ? 1 : files.failure(a(Argument.Third)),
  );
  method("NSData", false, "writeToURL:atomically:", async (self, a) =>
    Number(
      Boolean(a(0)) &&
        Boolean(await send(a(0), "isFileURL")) &&
        (await write(self, await files.sendNumber(a(0), "path"))),
    ),
  );
}

export function installDataReads(files: HostFiles): void {
  const { host } = files;
  host.method("NSData", true, "dataWithContentsOfFile:", async (_, a) => {
    const bytes = await files.contents(a(0));
    if (!bytes) return 0;
    const pointer = host.heap.alloc(Math.max(1, bytes.length));
    try {
      host.cpu.write(pointer, bytes);
      return host.autorelease(host.dataFrom(pointer, bytes.length));
    } finally {
      host.heap.free(pointer);
    }
  });
}
