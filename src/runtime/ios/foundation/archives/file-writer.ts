const OpenFlags = { WriteOnly: 1, Create: 0x200, Exclusive: 0x800 } as const;
const CHUNK_BYTES = 65_536;
interface FileWriterHost {
  open(path: string, flags: number): Promise<number>;
  write(descriptor: number, bytes: Uint8Array): Promise<number>;
  close(descriptor: number): Promise<number>;
  rename(source: string, destination: string): Promise<number>;
  remove(path: string): Promise<number>;
  unique(): string;
}
export async function writeArchiveFile(host: FileWriterHost, path: string, bytes: Uint8Array) {
  const temporary = path + "." + host.unique() + ".tmp";
  const descriptor = await host.open(
    temporary,
    OpenFlags.WriteOnly | OpenFlags.Create | OpenFlags.Exclusive,
  );
  if (descriptor < 0) return false;
  let closed = false,
    installed = false;
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const end = Math.min(bytes.length, offset + CHUNK_BYTES);
      const written = await host.write(descriptor, bytes.subarray(offset, end));
      if (written <= 0 || written > end - offset) return false;
      offset += written;
    }
    const result = await host.close(descriptor);
    closed = true;
    if (result !== 0) return false;
    installed = (await host.rename(temporary, path)) === 0;
    return installed;
  } finally {
    if (!closed) await host.close(descriptor);
    if (!installed) await host.remove(temporary);
  }
}
