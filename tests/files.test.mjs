import {test} from "vite-plus/test";
import assert from "node:assert/strict";
import { prepareBioShockConfig } from "../web/bioshock-config.mjs";
import { homeDirectories } from "../src/runtime/storage/records.ts";
import { fixture, writeSave, verifySave, isolated } from "./files-cases.mjs";

// Use identical guest calls against real IndexedDB in files-browser.py.
function memoryStorage() {
  const paths = new Map(homeDirectories.map(name => [name, { dir: true }]));
  const inodes = new Map();
  const chunks = new Map();
  let next = 1;
  const store = m => ({
    get: key => structuredClone(m.get(key)), keys: () => [...m.keys()], put: (k, v) => m.set(k, structuredClone(v)),
    add: v => { m.set(next, structuredClone(v)); return next++; }, delete: k => m.delete(k)
  });
  return { run: (_mode, fn) => fn({ paths: store(paths), inodes: store(inodes), chunks: {
    get: k => structuredClone(chunks.get(k.join(":"))), put: (k,v) => chunks.set(k.join(":"), structuredClone(v)),
    deleteInode: id => { for (const key of chunks.keys()) if (key.startsWith(id + ":")) chunks.delete(key); }
  } }), close() {}, inodes, chunks };
}
test("Darwin file and stdio calls preserve saves, descriptor identity and append semantics", async () => {
  const storage = memoryStorage();
  await writeSave("a", storage);
  await isolated("b", memoryStorage());
  await verifySave("a", storage);
  assert.equal(storage.inodes.size, 0);
  assert.equal(storage.chunks.size, 0);
});

test("lookup failure diagnostics give the guest path and errno and bound repeated probes", async () => {
  const events = [];
  const record = (level, area, message, details) => events.push({ level, area, message, details });
  const missing = [];
  const { call, heap, errno } = fixture("diagnostics", memoryStorage(), record, path => missing.push(path));
  const path = heap.string("CookedIPhone/Intro.xxx"), mode = heap.string("rb");
  for (let i = 0; i < 3; i++) assert.equal(await call("_fopen", path, mode), 0);
  assert.equal(errno(), 2);
  assert.deepEqual(events.map(e => e.details), [{ operation: "fopen", path: "CookedIPhone/Intro.xxx", errno: 2 }]);
  assert.equal(await call("_open", path, 0), -1);
  for (let i = 0; i < 40; i++) assert.equal(await call("_access", heap.string("probe-" + i), 0), -1);
  assert.equal(events.filter(e => e.level === "warn").length, 24);
  assert.match(events.at(-1).message, /sample limit/);
  assert.equal(await call("_access", heap.string("Documents/no-save"), 0), -1);
  assert.equal(missing.length, 44);
  assert.equal(missing[0], "Payload/Test.app/CookedIPhone/Intro.xxx");
});

test("BioShock installs writable INIs once and preserves saved edits on relaunch", async () => {
  const storage = memoryStorage(), prefix = "Payload/bioshock.app/BioshockConfig/";
  const original = new TextEncoder().encode("[Settings]\nVolume=80\n");
  const ipa = {bundlePath: "Payload/bioshock.app", info: {CFBundleIdentifier: "com.hip.180282"},
    entries: new Map([[prefix + "Default.ini", {}], [prefix + "Nested/Values.ini", {}]]),
    read: () => original};
  await prepareBioShockConfig(ipa, () => {}, storage);
  const {call, heap, cpu} = fixture("com.hip.180282", storage);
  const file = heap.string("/Documents/BioshockConfig/Nested/Values.ini");
  const scratch = heap.zero(128);
  let fd = await call("_open", file, 2);
  assert.ok(fd >= 3);
  assert.equal(await call("_read", fd, scratch, 128), original.length);
  assert.deepEqual(cpu.read(scratch, original.length), original);
  cpu.write(scratch, Uint8Array.of(10));
  assert.equal(await call("_write", fd, scratch, 1), 1);
  await call("_close", fd);
  await prepareBioShockConfig({...ipa, read: () => assert.fail("restaged existing config")}, () => {}, storage);
  fd = await call("_open", file, 0);
  assert.equal(await call("_read", fd, scratch, 128), original.length + 1);
  assert.equal(cpu.read(scratch + original.length, 1)[0], 10);
  await call("_close", fd);
});

test("Darwin chdir affects relative guest paths and getcwd reports the current directory", async () => {
  const x = fixture("cwd", memoryStorage());
  const scratch = x.heap.zero(200);
  function current() {
    return x.call("_getcwd", scratch, 200).then(p => new TextDecoder().decode(x.cpu.read(p, 200)).split("\0")[0]);
  }
  assert.equal(await current(), "/Payload/Test.app");
  assert.equal(await x.call("_chdir", x.heap.string("/Documents/SaveGames")), 0);
  assert.equal(await x.call("_mkdir", x.heap.string("slot-a")), 0);
  assert.equal(await x.call("_chdir", x.heap.string("slot-a")), 0);
  assert.equal(await current(), "/Documents/SaveGames/slot-a");
  assert.equal(await x.call("_chdir", x.heap.string("..")), 0);
  assert.equal(await current(), "/Documents/SaveGames");
  assert.equal(await x.call("_getcwd", scratch, 2), 0);
  assert.equal(x.errno(), 34);
  assert.equal(await x.call("_chdir", x.heap.string("/private/host")), -1);
  assert.equal(await current(), "/Documents/SaveGames");
});

test("Darwin stat and readdir use IPA metadata without reading any asset", async () => {
  const path = 'Payload/Test.app', asset = path + '/Maps/Intro.xxx';
  let reads = 0;
  const modified = new Date('2014-08-21T10:11:12Z').getTime();
  const entries = new Map([[asset, {size: 0x100000009, modified}], [path + '/Maps/More/Test.xxx', {size: 999}]]);
  const ipa = {bundlePath: path, info: {}, entries, directories: new Set([path + '/Maps/Empty']),
    has: name => entries.has(name), read: () => { reads++; return Uint8Array.of(17, 34, 51); }};
  const {call, heap, cpu, errno, files} = fixture('archive-metadata', memoryStorage(), undefined, undefined, ipa);
  const buf = heap.zero(109), filename = heap.string(asset);
  cpu.write(buf + 108, Uint8Array.of(0xcd));
  const view = () => new DataView(cpu.read(buf, 108).buffer);
  assert.equal(await call('_stat', filename, buf), 0);
  assert.equal(view().getBigUint64(60, true), 0x100000009n);
  assert.equal(view().getInt32(36, true), modified / 1000);
  assert.equal(view().getUint16(4, true), 0o100444);
  assert.equal(cpu.read(buf + 108, 1)[0], 0xcd);
  const inode = view().getBigUint64(8, true);
  const fd = await call('_open', filename, 0);
  assert.ok(fd >= 3);
  assert.equal(await call('_fstat', fd, buf), 0);
  assert.equal(view().getBigUint64(8, true), inode);
  assert.equal(await call('_lseek', fd, 0, 0, 2), 0x100000009n);
  const handle = await call('_opendir', heap.string('Maps'));
  assert.ok(handle);
  const list = [];
  for (let entry; (entry = await call('_readdir', handle));) {
    const values = new DataView(cpu.read(entry, 21).buffer), n = values.getUint16(18, true);
    const name = new TextDecoder().decode(cpu.read(entry + 21, n));
    assert.equal(cpu.read(entry + 21 + n, 1)[0], 0);
    assert.equal(values.getUint16(16, true), Math.ceil((22 + n) / 4) * 4);
    assert.equal(values.getBigUint64(8, true), BigInt(list.length + 1));
    assert.equal(values.getUint8(20), name === 'Intro.xxx' ? 8 : 4);
    if (name === 'Intro.xxx') assert.equal(values.getBigUint64(0, true), inode);
    list.push(name);
  }
  assert.deepEqual(list.sort(), ['.', '..', 'Empty', 'Intro.xxx', 'More']);
  assert.equal(await call('_closedir', handle), 0);
  assert.equal(await call('_readdir', handle), 0);
  assert.equal(errno(), 9);
  assert.equal(await call('_opendir', filename), 0);
  assert.equal(errno(), 20);
  assert.equal(reads, 0);
  assert.equal(await call('_lseek', fd, 0, 0, 0), 0n);
  assert.equal(await call('_read', fd, buf, 1), 1);
  assert.equal(await call('_read', fd, buf, 1), 1);
  assert.equal(reads, 1);
  await files.closeFiles();
});

test("save stat follows open inodes across rename and unlink, including sparse files", async () => {
  const {call, heap, cpu, errno, files} = fixture('save-metadata', memoryStorage());
  const dir = heap.string('/Documents/saves'), renamed = heap.string('/Documents/renamed');
  const buf = heap.zero(108), oldFile = heap.string('/Documents/saves/file'), newFile = heap.string('/Documents/renamed/file');
  const view = () => new DataView(cpu.read(buf, 108).buffer);
  assert.equal(await call('_mkdir', dir), 0);
  assert.equal(await call('_stat', dir, buf), 0);
  const dirInode = view().getBigUint64(8, true);
  const fd = await call('_open', oldFile, 0x202);
  assert.ok(fd >= 3);
  await call('_lseek', fd, 5, 1, 0);
  await call('_write', fd, buf, 1);
  assert.equal(await call('_rename', dir, renamed), 0);
  assert.equal(await call('_stat', renamed, buf), 0);
  assert.equal(view().getBigUint64(8, true), dirInode);
  const handle = await call('_opendir', renamed);
  assert.ok(handle);
  await call('_readdir', handle);
  await call('_readdir', handle);
  const entry = await call('_readdir', handle);
  const fileInode = new DataView(cpu.read(entry, 8).buffer).getBigUint64(0, true);
  assert.equal(new TextDecoder().decode(cpu.read(entry + 21, 4)), 'file');
  assert.equal(await call('_stat', newFile, buf), 0);
  assert.equal(view().getBigUint64(8, true), fileInode);
  assert.equal(view().getBigUint64(60, true), 0x100000006n);
  assert.equal(await call('_unlink', newFile), 0);
  assert.equal(await call('_stat', newFile, buf), -1);
  assert.equal(errno(), 2);
  assert.equal(await call('_readdir', handle), 0);
  assert.equal(errno(), 2);
  assert.equal(await call('_fstat', fd, buf), 0);
  assert.equal(view().getBigUint64(8, true), fileInode);
  assert.equal(view().getUint16(6, true), 0);
  assert.equal(await call('_closedir', handle), 0);
  assert.equal(await call('_close', fd), 0);
  assert.equal(await call('_fstat', fd, buf), -1);
  assert.equal(errno(), 9);
  await files.closeFiles();
});

test('concurrent descriptors share one large bundle asset and seek independently', async () => {
  const path = 'Payload/Test.app/level.xxx', size = 9 << 20;
  const bytes = new Uint8Array(size); bytes[size-1] = 91;
  let loads = 0;
  const ipa = {bundlePath: 'Payload/Test.app', entries: new Map([[path,{size}]]), has: p => p === path,
    assetBlob: async () => { loads++; return new Blob([bytes]); }, read: () => assert.fail('whole-array asset read')};
  const {call,heap,cpu} = fixture('large',memoryStorage(),undefined,undefined,ipa);
  const name = heap.string('/'+path), out=heap.zero(2);
  const first=await call('_open',name,0), second=await call('_open',name,0);
  assert.equal(loads,0);
  assert.equal(await call('_lseek',first,size-1,0,0),BigInt(size-1));
  assert.equal(await call('_read',first,out,2),1);
  assert.equal(cpu.read(out,1)[0],91);
  await call('_close',first);
  assert.equal(await call('_read',second,out,2),2);
  assert.deepEqual(cpu.read(out,2),new Uint8Array(2));
  assert.equal(loads,1);
  await call('_close',second);
});

test('temporary streams are unlinked and freopen preserves stream and descriptor identity',async()=>{
  const storage=memoryStorage(), {call,heap,cpu}=fixture('temporary-stdio',storage);
  const tmp=await call('_tmpfile'), fd=await call('_fileno',tmp), ptr=heap.string('abc'), mode=heap.string('w+');
  const buffer=heap.zero(120), file=await call('_tmpnam',buffer);
  assert.equal(file,buffer);
  const generated=new TextDecoder().decode(cpu.read(file,32)).split('\0')[0];
  assert.match(generated,/^\/tmp\//);
  assert.equal(await call('_stat',buffer,heap.zero(108)),-1);
  assert.equal(await call('_fwrite',ptr,1,3,tmp),3);
  assert.equal(await call('_rewind',tmp),undefined);
  assert.equal(await call('_getc',tmp),97);
  assert.equal(await call('_freopen',file,mode,tmp),tmp);
  assert.equal(await call('_fileno',tmp),fd);
  assert.equal(storage.inodes.size,1);
  assert.equal(await call('_fputc',100,tmp),100);
  assert.equal(await call('_fclose',tmp),0);
  assert.equal(await call('_chmod',file,0o400),0);
  assert.equal(await call('_open',file,1),-1);
  assert.equal(await call('_access',file,4),0);
  const r=await call('_fopen',file,heap.string('r'));
  assert.equal(await call('_getc',r),100);
  assert.equal(await call('_fclose',r),0);
});


test("unsupported extended attributes report Darwin errors without changing file data", async () => {
  const {call,files,heap,cpu,errno}=fixture("xattr",memoryStorage());
  const path=heap.string("/Documents/progress"),name=heap.string("com.apple.MobileBackup"),value=heap.zero(4);
  cpu.write(value,Uint8Array.of(7,8,9,10));
  const fd=await call("_open",path,0x202);assert.ok(fd>=3);assert.equal(await call("_write",fd,value,4),4);
  assert.equal(await call("_setxattr",path,name,value,4,0,0),-1);assert.equal(errno(),45);
  assert.equal(await call("_setxattr",heap.string("/Documents/missing"),name,value,4,0,0),-1);assert.equal(errno(),2);
  await call("_lseek",fd,0,0,0);cpu.write(value,new Uint8Array(4));assert.equal(await call("_read",fd,value,4),4);
  assert.deepEqual(cpu.read(value,4),Uint8Array.of(7,8,9,10));await files.closeFiles();
});
