// The native port prepares Documents/BioshockConfig before running game constructors.
import {SaveStorage} from '../src/runtime/storage/save-storage.ts';

export async function prepareBioShockConfig(ipa, diagnostic, storage) {
  if (ipa.info?.CFBundleIdentifier !== 'com.hip.180282' || !ipa.entries) return;
  const source = ipa.bundlePath + '/BioshockConfig/';
  const target = 'Documents/BioshockConfig';
  const entries = [...ipa.entries.keys()].filter(path => path.startsWith(source));
  if (!entries.length) return; // Executable-only startup archives omit game assets.

  const own = !storage;
  storage ??= new SaveStorage(ipa.info.CFBundleIdentifier);
  try {
    if (await storage.run('readonly', ({paths}) => paths.get(target))) return;
    diagnostic('info', 'files', 'Preparing writable BioShock configuration', {files: entries.length});
    // Blob reads cannot run inside an IndexedDB transaction. Stage the small
    // settings files first, then publish the complete directory atomically.
    const config = [];
    for (const path of entries) config.push([target + '/' + path.slice(source.length), await ipa.read(path)]);
    await storage.run('readwrite', async ({paths, inodes, chunks}) => {
      // Another tab may have completed installation during extraction.
      if (await paths.get(target)) return;
      const dirs = new Set([target]);
      for (const [name, data] of config) {
        for (let i = name.indexOf('/', target.length + 1); i !== -1; i = name.indexOf('/', i + 1)) {
          dirs.add(name.slice(0, i));
        }
        const inode = await inodes.add({size: data.byteLength, refs: 0, linked: true});
        await paths.put(name, {inode});
        for (let offset = 0; offset < data.length; offset += 65536) {
          const part = data.subarray(offset, offset + 65536);
          // Writable file chunks have a fixed size; later writes can extend the last chunk.
          const block = new Uint8Array(65536);
          block.set(part);
          await chunks.put([inode, offset / 65536], block);
        }
      }
      for (const dir of dirs) await paths.put(dir, {dir: true});
    });
  } finally {
    if (own) await storage.close();
  }
}
