import { Mode } from "../../libc/files/constants";
import { FileOpen, IO_CHUNK_BYTES, type HostFiles } from "./host-files";

async function copyFile(files: HostFiles, source: number, dest: number): Promise<boolean> {
  const input = await files.invoke("_open", source, FileOpen.Read);
  if (input < 0) return false;
  let out = -1,
    buffer = 0,
    ok = false;
  try {
    out = await files.invoke("_open", dest, FileOpen.WriteNew);
    if (out < 0) return false;
    buffer = files.host.heap.alloc(IO_CHUNK_BYTES);
    if (!buffer) return false;
    for (;;) {
      const count = await files.invoke("_read", input, buffer, IO_CHUNK_BYTES);
      if (count < 0) return false;
      if (count === 0) {
        ok = true;
        return true;
      }
      for (let offset = 0; offset < count;) {
        const written = await files.invoke("_write", out, buffer + offset, count - offset);
        if (written <= 0) return false;
        offset += written;
      }
    }
  } finally {
    if (buffer) files.host.heap.free(buffer);
    await files.invoke("_close", input);
    if (out >= 0) {
      await files.invoke("_close", out);
      if (!ok) await files.invoke("_unlink", dest);
    }
  }
}

export function removeTree(files: HostFiles, path: string): Promise<boolean> {
  return files.pathCall(path, async (pointer) => {
    const mode = await files.stat(pointer, 0);
    if (!mode) return false;
    if (!files.isDirectory(mode)) return (await files.invoke("_unlink", pointer)) === 0;
    const children = await files.listNames(pointer);
    if (!children) return false;
    for (const name of children) if (!(await removeTree(files, `${path}/${name}`))) return false;
    return (await files.invoke("_rmdir", pointer)) === 0;
  });
}

export function copyTree(files: HostFiles, from: string, to: string): Promise<boolean> {
  return files.pathCall(from, (source) =>
    files.pathCall(to, async (dest) => {
      const mode = await files.stat(source, 0);
      if (!mode) return false;
      if (files.isDirectory(mode)) {
        const entries = await files.listNames(source);
        if (!entries || (await files.invoke("_mkdir", dest, Mode.DirectoryDefault)) !== 0)
          return false;
        for (const name of entries) {
          if (!(await copyTree(files, `${from}/${name}`, `${to}/${name}`))) {
            await removeTree(files, to);
            return false;
          }
        }
        return true;
      }
      if ((mode & Mode.TypeMask) !== Mode.Regular) return false;
      return copyFile(files, source, dest);
    }),
  );
}
