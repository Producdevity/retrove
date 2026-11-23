import { Gauge, gauges } from "../../../diagnostics/gauges";
import {
  CHUNK_BYTES,
  CONSOLE_WRITE_LIMIT,
  FIRST_FILE_DESCRIPTOR,
  Open,
  Standard,
  Whence,
  ZERO,
} from "./constants";
import { Errno, raise } from "./errno";
import type { FileSystem } from "./file-system";
import { descriptorStat } from "./stat";
import { storedInode } from "./stored";
import type { LargeAsset, OpenFile, TransferResult } from "./types";

function savedInode(file: OpenFile): number {
  if (file.inode === undefined) throw new Error("Descriptor has no inode.");
  return file.inode;
}

async function readAsset(
  fs: FileSystem,
  asset: LargeAsset,
  offset: number,
  pointer: number,
  count: number,
): Promise<number> {
  const blob = await (asset.blob ??= asset.load());
  const source = (asset.source ??= {
    size: blob.size,
    slice(start, end) {
      gauges.add(Gauge.BundleReads, 1);
      gauges.add(Gauge.BundleReadBytes, end - start);
      return blob.slice(start, end);
    },
  });
  return fs.blocks.read(asset.path, source, offset, count, (done, bytes) => {
    fs.cpu.write(pointer + done, bytes);
  });
}

async function readBundle(
  fs: FileSystem,
  file: OpenFile,
  bundle: string,
  pointer: number,
  n: number,
): Promise<number> {
  if (file.asset) {
    const count = await readAsset(fs, file.asset, file.offset, pointer, n);
    file.offset += count;
    return count;
  }
  if (!file.data) {
    file.data = await fs.ipa.read(bundle);
    gauges.add(Gauge.FileCacheBytes, file.data.length);
  }
  const bytes = file.data.subarray(file.offset, file.offset + n);
  if (bytes.length) fs.cpu.write(pointer, bytes);
  file.offset += bytes.length;
  return bytes.length;
}

async function readSave(
  fs: FileSystem,
  file: OpenFile,
  pointer: number,
  n: number,
): Promise<number> {
  const id = savedInode(file);
  const amount = await fs.run("readonly", async ({ inodes, chunks }) => {
    const size = (await storedInode(inodes, id)).size ?? 0;
    const total = Math.max(0, Math.min(size - file.offset, n));
    for (let done = 0; done < total;) {
      const pos = file.offset + done,
        local = pos % CHUNK_BYTES;
      const count = Math.min(CHUNK_BYTES - local, total - done);
      const block = await chunks.get([id, Math.floor(pos / CHUNK_BYTES)]);
      fs.cpu.write(
        pointer + done,
        block ? block.subarray(local, local + count) : new Uint8Array(count),
      );
      done += count;
    }
    return total;
  });
  file.offset += amount;
  return amount;
}

export async function readDescriptor(
  fs: FileSystem,
  fd: number,
  pointer: number,
  n: number,
): Promise<TransferResult> {
  if (fd === Standard.Input && !fs.fds.has(fd) && !fs.closedStandard.has(Standard.Input)) return 0;
  const file = fs.fdFor(fd);
  if (file.device) return file.device.read(pointer, n);
  if (file.mode === Open.WriteOnly) raise(Errno.BadDescriptor);
  if (!n) return 0;
  if (file.bundle) return readBundle(fs, file, file.bundle, pointer, n);
  return readSave(fs, file, pointer, n);
}

async function writeSave(
  fs: FileSystem,
  file: OpenFile,
  pointer: number,
  n: number,
): Promise<number> {
  const id = savedInode(file);
  const end = await fs.run("readwrite", async ({ inodes, chunks }) => {
    const node = await storedInode(inodes, id);
    const start = file.append ? (node.size ?? 0) : file.offset;
    if (!Number.isSafeInteger(start + n)) raise(Errno.TooBig);
    for (let done = 0; done < n;) {
      const pos = start + done,
        local = pos % CHUNK_BYTES;
      const count = Math.min(CHUNK_BYTES - local, n - done);
      const key: [number, number] = [id, Math.floor(pos / CHUNK_BYTES)];
      const bytes = fs.cpu.read(pointer + done, count);
      if (count === CHUNK_BYTES) await chunks.put(key, bytes);
      else {
        const block = (await chunks.get(key)) ?? new Uint8Array(CHUNK_BYTES);
        block.set(bytes, local);
        await chunks.put(key, block);
      }
      done += count;
    }
    node.size = Math.max(node.size ?? 0, start + n);
    node.modified = Date.now();
    await inodes.put(id, node);
    return start + n;
  });
  file.offset = end;
  return n;
}

export async function writeDescriptor(
  fs: FileSystem,
  fd: number,
  pointer: number,
  n: number,
): Promise<TransferResult> {
  if (
    (fd === Standard.Output || fd === Standard.Error) &&
    !fs.fds.has(fd) &&
    !fs.closedStandard.has(fd)
  ) {
    fs.log(new TextDecoder().decode(fs.cpu.read(pointer, Math.min(n, CONSOLE_WRITE_LIMIT))));
    return n;
  }
  const file = fs.fdFor(fd);
  if (file.device) return file.device.write(pointer, n);
  if (!file.mode) raise(Errno.BadDescriptor);
  if (!n) return 0;
  return writeSave(fs, file, pointer, n);
}

export async function seekDescriptor(
  fs: FileSystem,
  fd: number,
  distance: bigint,
  origin: number,
): Promise<bigint> {
  if (fd < FIRST_FILE_DESCRIPTOR && !fs.fds.has(fd)) raise(Errno.IllegalSeek);
  const file = fs.fdFor(fd);
  if (origin > Whence.End) raise(Errno.Invalid);
  if (file.device) raise(Errno.IllegalSeek);
  const start =
    origin === Whence.End
      ? ((await descriptorStat(fs, fd)).size ?? 0)
      : origin === Whence.Current
        ? file.offset
        : 0;
  const pos = BigInt(start) + distance;
  if (pos < ZERO) raise(Errno.Invalid);
  if (pos > BigInt(Number.MAX_SAFE_INTEGER)) raise(Errno.Overflow);
  file.offset = Number(pos);
  return pos;
}

export async function closeDescriptor(fs: FileSystem, fd: number): Promise<number> {
  if (fs.isStandard(fd)) {
    fs.closedStandard.add(fd);
    return 0;
  }
  const file = fs.fdFor(fd);
  if (file.device) await file.device.close();
  if (file.asset && --file.asset.references === 0 && file.bundle)
    fs.largeAssets.delete(file.bundle);
  if (file.data) gauges.add(Gauge.FileCacheBytes, -file.data.length);
  const id = file.inode;
  if (id !== undefined) {
    await fs.run("readwrite", async ({ inodes, chunks }) => {
      const node = await storedInode(inodes, id);
      node.refs--;
      if (!node.refs && !node.linked) {
        await inodes.delete(id);
        await chunks.deleteInode(id);
      } else await inodes.put(id, node);
    });
  }
  fs.fds.delete(fd);
  if (fd < FIRST_FILE_DESCRIPTOR) fs.closedStandard.add(fd);
  return 0;
}

/** Standard I/O on a socket descriptor cannot be resumed from a stream. */
export function immediate(result: TransferResult): number {
  if (typeof result !== "number") raise(Errno.Invalid);
  return result;
}
