import { fileImports } from "../src/runtime/ios/libc/files/index.ts";

function same(a, b) {
  if (a !== b) throw Error("File operation returned " + String(a) + ", expected " + String(b));
}
export function fixture(namespace, storage, diagnostic, missingAsset, ipa) {
  const memory = new Uint8Array(65536);
  const cpu = { read: (p, n) => memory.slice(p, p + n), write: (p, bytes) => memory.set(bytes, p) };
  const view = new DataView(memory.buffer);
  let end = 1024;
  const heap = {
    zero(n) { const p = end; end += n; memory.fill(0, p, end); return p; },
    free() {},
    string(s) { const b = new TextEncoder().encode(s + "\0"); const p = this.zero(b.length); cpu.write(p, b); return p; }
  };
  const files = fileImports(cpu, ipa ?? { bundlePath: "Payload/Test.app", info: { CFBundleIdentifier: namespace },
    has: () => false, entries: new Map() }, heap, 8, s => { if (s) console.log(s); }, storage, diagnostic, missingAsset);
  const call = (name, ...args) => files[name](i => args[i] ?? 0);
  return { call, files, heap, cpu, errno: () => view.getUint32(8,true) };
}

export async function writeSave(namespace, storage) {
  const { call, files, heap, cpu, errno } = fixture(namespace, storage);
  const folder = heap.string("/Documents/SaveGames/Test");
  const temporary = heap.string("/Documents/SaveGames/Test/work");
  const target = heap.string("Documents/SaveGames/Test/slot");
  const missing = heap.string("/Documents/Missing/slot");
  const bad = heap.string("/Documents/../private");
  const scratch = heap.zero(16);
  same(await call("_mkdir", folder), 0);
  same(await call("_mkdir", folder), -1); same(errno(), 17);
  same(await call("_open", missing, 0x202), -1); same(errno(), 2);
  same(await call("_open", bad, 0x202), -1); same(errno(), 13);
  same(await call("_open", heap.string("/Payload/Test.app/wrong"), 0x202), -1); same(errno(), 30);
  // The app's home holds both the bundle and Documents, as on iOS.
  const sibling = await call("_open", heap.string("/Payload/Test.app//../Documents/sibling"), 0xA02);
  same(sibling >= 0, true);
  same(await call("_access", heap.string("/Documents/sibling"), 0), 0);
  same(await call("_close", sibling), 0);
  same(await call("_unlink", heap.string("/Documents/sibling")), 0);
  const old = await call("_open", target, 0xA02);
  const fd = await call("_open", temporary, 0xA02);
  same(await call("_open", temporary, 0xA02), -1); same(errno(), 17);
  cpu.write(scratch, Uint8Array.of(11, 22, 33));
  same(await call("_write", old, scratch, 1), 1);
  same(await call("_write", fd, scratch, 3), 3);
  same(await call("_lseek", fd, 0, 1, 0), 0x100000000n);
  same(await call("_lseek", fd, 2, 0, 2), 5n);
  same(await call("_write", fd, scratch, 1), 1);
  same(await call("_fsync", fd), 0);
  same(await call("_rename", temporary, target), 0);
  same(await call("_access", temporary, 0), -1); same(errno(), 2);
  same(await call("_lseek", old, 0, 0, 0), 0n);
  same(await call("_read", old, scratch, 6), 1);
  same(cpu.read(scratch, 1)[0], 11);
  const append = await call("_open", target, 9);
  same(await call("_lseek", append, 0, 0, 0), 0n);
  cpu.write(scratch, Uint8Array.of(99));
  same(await call("_write", append, scratch, 1), 1);
  same(await call("_lseek", fd, 0xffffffff, 0xffffffff, 2), 6n);
  same(await call("_read", fd, scratch, 10), 1);
  same(cpu.read(scratch, 1)[0], 99);
  same(await call("_read", fd, scratch, 10), 0);
  same(await call("_rmdir", folder), -1); same(errno(), 66);
  same(await call("_lseek", 972, 0, 0, 0), -1n); same(errno(), 9);
  await files.closeFiles();
}

export async function verifySave(namespace, storage) {
  const { call, files, heap, cpu, errno } = fixture(namespace, storage);
  const target = heap.string("/Documents/SaveGames/Test/slot");
  const p = await call("_fopen", target, heap.string("rb"));
  if (!p) throw Error("Save did not persist");
  const scratch = heap.zero(16);
  same(await call("_fread", scratch, 1, 7, p), 7);
  same([...cpu.read(scratch, 7)].join(","), "11,22,33,0,0,11,99");
  same(await call("_feof", p), 0);
  same(await call("_fread", scratch, 1, 1, p), 0);
  same(await call("_feof", p), 1);
  same(await call("_fseek", p, 0, 0), 0);
  same(await call("_feof", p), 0);
  same(await call("_fclose", p), 0);
  const folder = heap.string("/Documents/SaveGames/Test"), renamed = heap.string("/Library/slot-dir");
  same(await call("_rename", folder, renamed), 0);
  const file = heap.string("/Library/slot-dir/slot");
  same(await call("_access", target), -1); same(errno(), 2);
  const f = await call("_fopen", file, heap.string("wb+"));
  if (!f) throw Error("Cannot truncate save file");
  same(await call("_fread", scratch, 1, 1, f), 0);
  same(await call("_fwrite", scratch, 2, 2, f), 2);
  same(await call("_unlink", file), 0);
  same(await call("_access", file), -1);
  same(await call("_fseek", f, 0, 0), 0);
  same(await call("_fread", scratch, 1, 4, f), 4);
  same(await call("_fclose", f), 0);
  same(await call("_rmdir", renamed), 0);
  await files.closeFiles();
}

export async function isolated(namespace, storage) {
  const { call, files, heap, errno } = fixture(namespace, storage);
  same(await call("_access", heap.string("/Documents/SaveGames/Test/slot")), -1); same(errno(), 2);
  await files.closeFiles();
}

// Exercise a browser-terminated runtime. Reload the page before checking recovery.
export async function leaveOrphan(namespace) {
  const { call, heap, cpu } = fixture(namespace);
  const path = heap.string("/tmp/unlinked-while-open");
  const fd = await call("_open", path, 0x202);
  if (fd < 0) throw Error("Orphan setup failed");
  const buffer = heap.zero(8);
  cpu.write(buffer, Uint8Array.of(17));
  same(await call("_write", fd, buffer, 1), 1);
  same(await call("_unlink", path), 0);
}
export async function verifyRecovery(namespace) {
  const { SaveStorage } = await import("../src/runtime/storage/save-storage.ts");
  const storage = new SaveStorage(namespace);
  try {
    await storage.run("readonly", async ({ inodes, chunks }) => {
      same((await inodes.keys()).length, 0);
      same((await chunks.keys()).length, 0);
    });
  } finally { await storage.close(); }
}
