import {DIRENT_BYTES, direntBytes, statBytes, virtualInode} from '../src/runtime/ios/libc/file-metadata.ts';
import { readCStringBytes, readString, write32 } from "./memory.mjs";
import { SaveStorage } from "../src/runtime/storage/save-storage.ts";

const E = { PERM: 1, NOENT: 2, IO: 5, BADF: 9, NOMEM: 12, ACCESS: 13, FAULT: 14, EXIST: 17,
  NOTDIR: 20, ISDIR: 21, INVAL: 22, FBIG: 27, NOSPC: 28, SPIPE: 29, ROFS: 30, RANGE: 34,
  NOTSUP: 45, NAMETOOLONG: 63, NOTEMPTY: 66, OVERFLOW: 84 };
const APPEND = 8, CREAT = 0x200, TRUNC = 0x400, EXCL = 0x800;
const roots = new Set(["Documents", "Library", "tmp"]);
class FileError extends Error {
  constructor(errno) { super("File error " + errno); this.errno = errno; }
}
function error(errno) { throw new FileError(errno); }
function parent(path) { return path.slice(0, path.lastIndexOf("/")); }
// Separate chunks keep small writes and sparse seeks independent of total save size.
const CHUNK = 64 * 1024;

export function fileImports(cpu, ipa, heap, errno, log,
  storage = new SaveStorage(ipa.info?.CFBundleIdentifier || ipa.bundlePath), diagnostic, missingAsset, data) {
  const fds = new Map(), streams = new Map(), directoryStreams = new Map();
  const largeAssets = new Map();
  let next = 3, tmpnameBuffer;
  const bundleDirectory = '/' + ipa.bundlePath;
  let currentDirectory = bundleDirectory;
  const fail = (n, ret = -1) => { write32(cpu, errno, n); return ret; };
  const run = async (mode, action) => {
    try { return await storage.run(mode, action); }
    catch (e) {
      if (e instanceof FileError) throw e;
      if (e?.name === "QuotaExceededError") error(E.NOSPC);
      log("Save storage error: " + (e?.message || e));
      error(E.IO);
    }
  };
  const seenLookups = new Set();
  function recordLookup(operation, address, errno) {
    if (seenLookups.size >= 24) return;
    let path;
    try { path = readString(cpu, address).slice(0, 512); }
    catch { path = "<unreadable path>"; }
    const key = operation + ":" + errno + ":" + path;
    if (seenLookups.has(key)) return;
    seenLookups.add(key);
    diagnostic("warn", "files", "Guest file lookup failed", { operation, path, errno });
    if (seenLookups.size === 24) diagnostic("info", "files", "Reached the 24 distinct lookup failure sample limit");
  }
  const checked = (fn, fallback = -1, operation) => async a => {
    try { return await fn(a); }
    catch (e) {
      if (!(e instanceof FileError)) throw e;
      if (diagnostic && operation) recordLookup(operation, a(0), e.errno);
      return fail(e.errno, fallback);
    }
  };
  function locate(address) {
    const raw = readString(cpu, address);
    if (!raw) error(E.NOENT);
    if (raw.includes("\\")) error(E.ACCESS);
    const first = raw.split("/", 1)[0];
    let absolute;
    if (raw.startsWith("/")) absolute = raw;
    else if (raw.startsWith("~/")) absolute = raw.slice(1);
    else if (raw === ipa.bundlePath || raw.startsWith(ipa.bundlePath + "/") ||
        (currentDirectory === bundleDirectory && roots.has(first))) absolute = "/" + raw;
    else absolute = currentDirectory + "/" + raw;
    const parts = [];
    for (const part of absolute.split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    const path = parts.join("/");
    if (!path || roots.has(parts[0])) return {home: path};
    if (path === ipa.bundlePath || path.startsWith(ipa.bundlePath + "/")) return {bundle: path};
    error(E.ACCESS);
  }
  function writable(address) {
    const p = locate(address);
    if (!Object.hasOwn(p, "home")) error(E.ROFS);
    if (!p.home || roots.has(p.home)) error(E.PERM);
    return p.home;
  }
  async function requireParent(paths, path) {
    const up = parent(path);
    const item = await paths.get(up);
    if (!item) error(E.NOENT);
    if (!item.dir) error(E.NOTDIR);
  }
  let bundleDirectories;
  function bundleIndex() {
    if (bundleDirectories) return bundleDirectories;
    const dirs = new Map([[ipa.bundlePath, new Map()]]);
    function index(path, isDirectory) {
      if (!path.startsWith(ipa.bundlePath + "/")) return;
      let dir = ipa.bundlePath;
      const parts = path.slice(dir.length + 1).split("/");
      for (let i = 0; i < parts.length; i++) {
        const child = parts[i], key = dir + "/" + child;
        const isDir = isDirectory || i + 1 < parts.length;
        const children = dirs.get(dir);
        if (!children.has(child)) children.set(child, {name: child, dir: isDir, inode: virtualInode(key)});
        if (isDir && !dirs.has(key)) dirs.set(key, new Map());
        dir = key;
      }
    }
    for (const path of ipa.entries?.keys() ?? []) index(path, false);
    for (const path of ipa.directories ?? []) index(path, true);
    bundleDirectories = dirs;
    return dirs;
  }
  const bundleIsDir = path => bundleIndex().has(path);
  function missingBundlePath(path) {
    missingAsset?.(path);
    error(E.NOENT);
  }
  const fdFor = fd => fds.get(fd) ?? error(E.BADF);
  const streamFor = ptr => streams.get(ptr) ?? error(E.BADF);
  async function open(address, flags) {
    const mode = flags & 3;
    // Refuse unsupported flags, including advisory locks and directory descriptors.
    const supported = 3 | APPEND | CREAT | TRUNC | EXCL | 0x80 | 0x100 | 0x20000 | 0x1000000;
    if (mode === 3 || ((flags & TRUNC) && !mode)) error(E.INVAL);
    if (flags & ~supported) error(E.NOTSUP);
    const p = locate(address);
    const file = { mode, path:p.bundle??p.home, append: !!(flags & APPEND), offset: 0 };
    if (p.bundle) {
      if (mode || (flags & (CREAT | TRUNC))) error(E.ROFS);
      if (!ipa.has(p.bundle)) {
        if (bundleIsDir(p.bundle)) error(E.ISDIR);
        missingBundlePath(p.bundle);
      }
      file.bundle = p.bundle;
      if (ipa.assetBlob && ipa.entries.get(p.bundle).size >= 8 * 1024 * 1024) {
        let asset = largeAssets.get(p.bundle);
        if (!asset) { asset = {references: 0, blob: null}; largeAssets.set(p.bundle, asset); }
        asset.references++;
        file.asset = asset;
      }
    } else {
      if (!p.home) error(E.ISDIR);
      file.inode = await run("readwrite", async ({ paths, inodes, chunks }) => {
        let entry = await paths.get(p.home);
        if (entry && (flags & CREAT) && (flags & EXCL)) error(E.EXIST);
        if (entry?.dir) error(E.ISDIR);
        let node;
        if (!entry) {
          if (!(flags & CREAT)) error(E.NOENT);
          await requireParent(paths, p.home);
          const now = Date.now();
          node = { size: 0, refs: 1, linked: true, created: now, modified: now };
          const inode = await inodes.add(node);
          await paths.put(p.home, { inode });
          return inode;
        }
        node = await inodes.get(entry.inode);
        const permissions=node.permissions ?? 0o644;
        if ((mode !== 1 && !(permissions & 0o400)) || (mode !== 0 && !(permissions & 0o200))) error(E.ACCESS);
        node.refs++;
        if (flags & TRUNC) { node.size = 0; node.modified = Date.now(); await chunks.deleteInode(entry.inode); }
        await inodes.put(entry.inode, node);
        return entry.inode;
      });
    }
    const fd = next++;
    fds.set(fd, file);
    return fd;
  }
  async function read(fd, pointer, n) {
    if (fd === 0 && !fds.has(fd) && !closedStandard.has(0)) return 0;
    const file = fdFor(fd);
    if (file.device) return file.device.read(pointer,n);
    if (file.mode === 1) error(E.BADF);
    if (!n) return 0;
    if (file.bundle) {
      if (file.asset) {
        const blob = await (file.asset.blob ??= ipa.assetBlob(file.bundle));
        const count = Math.max(0, Math.min(blob.size - file.offset, n));
        for (let i = 0; i < count; i += 1024 * 1024) {
          const start = file.offset + i;
          const bytes = await blob.slice(start, start + Math.min(count - i, 1024 * 1024)).arrayBuffer();
          cpu.write(pointer + i, new Uint8Array(bytes));
        }
        file.offset += count;
        return count;
      }
      file.data ??= await ipa.read(file.bundle);
      const bytes = file.data.subarray(file.offset, file.offset + n);
      if (bytes.length) cpu.write(pointer, bytes);
      file.offset += bytes.length;
      return bytes.length;
    }
    const amount = await run("readonly", async ({ inodes, chunks }) => {
      const { size } = await inodes.get(file.inode);
      const total = Math.max(0, Math.min(size - file.offset, n));
      for (let done = 0; done < total;) {
        const pos = file.offset + done, local = pos % CHUNK;
        const count = Math.min(CHUNK - local, total - done);
        const block = await chunks.get([file.inode, Math.floor(pos / CHUNK)]);
        cpu.write(pointer + done, block ? block.subarray(local, local + count) : new Uint8Array(count));
        done += count;
      }
      return total;
    });
    file.offset += amount;
    return amount;
  }
  async function write(fd, pointer, n) {
    if ((fd === 1 || fd === 2) && !fds.has(fd) && !closedStandard.has(fd)) {
      log(new TextDecoder().decode(cpu.read(pointer, Math.min(n, 65536))));
      return n;
    }
    const file = fdFor(fd);
    if (file.device) return file.device.write(pointer,n);
    if (!file.mode) error(E.BADF);
    if (!n) return 0;
    const end = await run("readwrite", async ({ inodes, chunks }) => {
      const node = await inodes.get(file.inode);
      const start = file.append ? node.size : file.offset;
      if (!Number.isSafeInteger(start + n)) error(E.FBIG);
      for (let done = 0; done < n;) {
        const pos = start + done, local = pos % CHUNK;
        const count = Math.min(CHUNK - local, n - done);
        const key = [file.inode, Math.floor(pos / CHUNK)];
        const bytes = cpu.read(pointer + done, count);
        if (count === CHUNK) await chunks.put(key, bytes);
        else {
          const block = await chunks.get(key) || new Uint8Array(CHUNK);
          block.set(bytes, local);
          await chunks.put(key, block);
        }
        done += count;
      }
      node.size = Math.max(node.size, start + n);
      node.modified = Date.now();
      await inodes.put(file.inode, node);
      return start + n;
    });
    file.offset = end;
    return n;
  }
  async function seek(fd, distance, origin) {
    if (fd < 3 && !fds.has(fd)) error(E.SPIPE);
    const file = fdFor(fd);
    if (origin > 2) error(E.INVAL);
    if (file.device) error(E.SPIPE);
    const start = origin === 2 ? (await descriptorStat(fd)).size : origin === 1 ? file.offset : 0;
    const pos = BigInt(start) + distance;
    if (pos < 0n) error(E.INVAL);
    if (pos > BigInt(Number.MAX_SAFE_INTEGER)) error(E.OVERFLOW);
    file.offset = Number(pos);
    return pos;
  }
  async function close(fd) {
    if (fd < 3 && !fds.has(fd) && !closedStandard.has(fd)) { closedStandard.add(fd); return 0; }
    const file = fdFor(fd);
    if (file.device) await file.device.close();
    if (file.asset && --file.asset.references === 0) largeAssets.delete(file.bundle);
    if (file.inode !== undefined) {
      await run("readwrite", async ({ inodes, chunks }) => {
        const node = await inodes.get(file.inode);
        node.refs--;
        if (!node.refs && !node.linked) { await inodes.delete(file.inode); await chunks.deleteInode(file.inode); }
        else await inodes.put(file.inode, node);
      });
    }
    fds.delete(fd);
    if(fd<3)closedStandard.add(fd);
    return 0;
  }
  async function dropLink(stores, path, item) {
    await stores.paths.delete(path);
    if (item.dir) {
      if (item.inode !== undefined) await stores.inodes.delete(item.inode);
      return;
    }
    const node = await stores.inodes.get(item.inode);
    if (!node.refs) { await stores.inodes.delete(item.inode); await stores.chunks.deleteInode(item.inode); }
    else { node.linked = false; await stores.inodes.put(item.inode, node); }
  }
  async function remove(address, dir) {
    const path = writable(address);
    return run("readwrite", async stores => {
      const item = await stores.paths.get(path);
      if (!item) error(E.NOENT);
      if (!!item.dir !== dir) error(dir ? E.NOTDIR : E.ISDIR);
      if (dir && (await stores.paths.keys()).some(key => key.startsWith(path + "/"))) error(E.NOTEMPTY);
      await dropLink(stores, path, item);
      return 0;
    });
  }
  async function rename(from, to) {
    const src = writable(from), dst = writable(to);
    return run("readwrite", async stores => {
      const { paths } = stores;
      const item = await paths.get(src);
      if (!item) error(E.NOENT);
      if (src === dst) return 0;
      if (item.dir && dst.startsWith(src + "/")) error(E.INVAL);
      await requireParent(paths, dst);
      const previous = await paths.get(dst);
      if (previous) {
        if (!!previous.dir !== !!item.dir) error(item.dir ? E.NOTDIR : E.ISDIR);
        if (previous.dir && (await paths.keys()).some(key => key.startsWith(dst + "/"))) error(E.NOTEMPTY);
        await dropLink(stores, dst, previous);
      }
      const children = item.dir ? (await paths.keys()).filter(key => key.startsWith(src + "/")) : [];
      for (const key of [src, ...children]) {
        const moved = key === src ? item : await paths.get(key);
        if (moved.dir && moved.inode === undefined) moved.original ??= key;
        await paths.put(dst + key.slice(src.length), moved);
        await paths.delete(key);
      }
      return 0;
    });
  }
  async function access(address, mode) {
    const p = locate(address);
    if (p.bundle) {
      if (!ipa.has(p.bundle) && !bundleIsDir(p.bundle)) missingBundlePath(p.bundle);
      if (mode & 2) error(E.ROFS);
    } else {
      const st=await pathStat(p);
      if ((mode & 7) !== (mode & (st.mode >>> 6) & 7)) error(E.ACCESS);
    }
    return 0;
  }
  function bundleStat(path) {
    const entry = ipa.entries?.get(path);
    if (entry || ipa.has(path)) return {device: 1, inode: virtualInode(path), size: entry?.size ?? 0,
      mode: path === ipa.executablePath ? 0o100555 : 0o100444, modified: entry?.modified ?? 0};
    if (!bundleIsDir(path)) missingBundlePath(path);
    return {device: 1, inode: virtualInode(path), mode: 0o40555, links: 2, size: 0};
  }
  const homeInode = (path, item) => item.inode ?? virtualInode(item.original ?? path);
  function saveStat(inode, node) {
    return {device: 2, inode, mode: 0o100000 | (node.permissions ?? 0o644), size: node.size,
      links: node.linked ? 1 : 0, modified: node.modified ?? 0, created: node.created ?? 0};
  }
  async function setMetadata(address, update) {
    const path=locate(address);
    if(path.bundle) {await pathStat(path);error(E.ROFS);}
    if(!path.home)error(E.PERM);
    return run('readwrite',async({paths,inodes})=>{
      const item=await paths.get(path.home);
      if(!item)error(E.NOENT);
      if(item.dir) {Object.assign(item,update);await paths.put(path.home,item);}
      else {const node=await inodes.get(item.inode);Object.assign(node,update);await inodes.put(item.inode,node);}
      return 0;
    });
  }
  async function descriptorStat(fd) {
    if (fd < 3 && !fds.has(fd) && !closedStandard.has(fd)) return {device: 3, inode: fd, mode: 0o20666, size: 0};
    const file = fdFor(fd);
    if (file.device) return {device:3,inode:fd,mode:0o140666,size:0};
    if (file.bundle) return bundleStat(file.bundle);
    return run("readonly", async ({inodes}) => saveStat(file.inode, await inodes.get(file.inode)));
  }
  async function pathStat(p) {
    if (p.bundle) return bundleStat(p.bundle);
    if (!p.home) return {device: 2, inode: virtualInode(""), mode: 0o40755, links: 2, size: 0};
    return run("readonly", async ({paths, inodes}) => {
      const item = await paths.get(p.home);
      if (!item) error(E.NOENT);
      if (item.dir) return {device: 2, inode: homeInode(p.home, item), mode: 0o40000 | (item.permissions ?? 0o755), links: 2, size: 0, modified:item.modified??0,created:item.created??0};
      return saveStat(item.inode, await inodes.get(item.inode));
    });
  }
  async function directoryEntries(p) {
    if (p.bundle) {
      const children = bundleIndex().get(p.bundle);
      if (!children) { if (ipa.has(p.bundle)) error(E.NOTDIR); missingBundlePath(p.bundle); }
      const up = p.bundle === ipa.bundlePath ? ipa.bundlePath : parent(p.bundle);
      return [{name: ".", dir: true, inode: virtualInode(p.bundle)}, {name: "..", dir: true, inode: virtualInode(up)},
        ...children.values()];
    }
    return run("readonly", async ({paths}) => {
      const folder = p.home;
      const self = folder ? await paths.get(folder) : {dir: true};
      if (!self) error(E.NOENT);
      if (!self.dir) error(E.NOTDIR);
      const up = folder.includes("/") ? parent(folder) : "";
      const above = up ? await paths.get(up) : {dir: true};
      const contents = [{name: ".", dir: true, inode: homeInode(folder, self)},
        {name: "..", dir: true, inode: homeInode(up, above)}];
      const prefix = folder ? folder + "/" : "";
      for (const path of await paths.keys()) {
        if (!path.startsWith(prefix)) continue;
        const name = path.slice(prefix.length);
        if (!name || name.includes("/")) continue;
        const item = await paths.get(path);
        contents.push({name, dir: !!item.dir, inode: homeInode(path, item)});
      }
      return contents;
    });
  }
  function closeDirectory(handle) {
    if (!directoryStreams.delete(handle)) error(E.BADF);
    heap.free(handle);
    return 0;
  }
  function setStreamStatus(ptr, stream) {
    const flags = stream.flags | (stream.eof ? 0x20 : 0) | (stream.error ? 0x40 : 0);
    const bytes = new Uint8Array(4), d = new DataView(bytes.buffer);
    d.setUint16(0, flags, true); d.setInt16(2, stream.fd, true);
    cpu.write(ptr + 12, bytes);
  }
  const closedStandard = new Set();
  if (data) {
    for (const [fd, symbol] of ['___stdinp','___stdoutp','___stderrp'].entries()) {
      const ptr = heap.zero(96), slot = heap.zero(4);
      if (!ptr || !slot) throw Error('Guest heap exhausted creating standard streams');
      const stream = {fd, flags:fd === 0 ? 4 : 8, eof:false, error:false};
      streams.set(ptr,stream); setStreamStatus(ptr,stream);
      write32(cpu,slot,ptr); data.set(symbol,slot);
    }
  }
  async function streamRead(stream, dst, count) {
    if (!count) return 0;
    let copied=0;
    if (stream.pushback !== undefined) {
      cpu.write(dst,Uint8Array.of(stream.pushback));
      delete stream.pushback; copied=1;
    }
    return copied+await read(stream.fd,dst+copied,count-copied);
  }
  function transferStdIO(doWrite) {
    return checked(async a => {
      const ptr = a(3), s = streamFor(ptr), bytes = a(1) * a(2);
      if (!bytes) return 0;
      if (!Number.isSafeInteger(bytes) || bytes > 0x7fffffff) error(E.INVAL);
      try {
        const count = doWrite ? await write(s.fd, a(0), bytes) : await streamRead(s, a(0), bytes);
        if (!doWrite && count < bytes) s.eof = true;
        setStreamStatus(ptr, s);
        return Math.floor(count / a(1));
      } catch (e) { s.error = true; setStreamStatus(ptr, s); throw e; }
    }, 0);
  }
  function streamMode(address) {
    const mode=readString(cpu,address);
    if(!/^[rwa](?:b?\+?|\+b)$/.test(mode)) error(E.INVAL);
    const access=mode.includes('+') ? 2 : mode[0]==='r' ? 0 : 1;
    return {access, flags:access | ({r:0,w:CREAT|TRUNC,a:CREAT|APPEND})[mode[0]]};
  }
  async function newStream(fd, access, ptr=heap.zero(96)) {
    if(!ptr){await close(fd);error(E.NOMEM);}
    const s={fd,flags:[4,8,16][access],eof:false,error:false};
    streams.set(ptr,s);setStreamStatus(ptr,s);return ptr;
  }
  async function writeBytes(fd, bytes) {
    if((fd===1||fd===2)&&!fds.has(fd)&&!closedStandard.has(fd)){
      log(new TextDecoder().decode(bytes));return bytes.length;
    }
    const p=heap.alloc(bytes.length);
    if(!p)return fail(E.NOMEM);
    try {cpu.write(p,bytes);return await write(fd,p,bytes.length);}
    catch(e){if(e instanceof FileError)return fail(e.errno);throw e;}
    finally {heap.free(p);}
  }
  const funcs = {
    _open: checked(a => open(a(0), a(1)), -1, "open"), _read: checked(a => read(a(0), a(1), a(2))),
    _write: checked(a => write(a(0), a(1), a(2))), _close: checked(a => close(a(0))),
    // iOS ARMv7 aligns 64-bit arguments on four-byte boundaries: fd=r0,
    // offset=r1:r2 (low:high), origin=r3. off_t returns in r0:r1.
    _lseek: checked(a => seek(a(0), BigInt.asIntN(64, BigInt(a(1)) | (BigInt(a(2)) << 32n)), a(3)), -1n),
    _fcntl: checked(a => {
      const fd=a(0),cmd=a(1),arg=a(2),file=fdFor(fd);
      switch(cmd) {
        case 1:return file.closeOnExec?1:0;
        case 2:file.closeOnExec=Boolean(arg&1);return 0;
        case 3:return file.mode|(file.append?8:0)|(file.nonblocking?4:0);
        case 4:file.nonblocking=Boolean(arg&4);file.append=Boolean(arg&8);return 0;
        case 48:return 0; // F_NOCACHE is an advisory hint.
        case 50: {
          if (!arg) error(E.FAULT);
          if (!file.path || file.device) error(E.INVAL);
          const name=new TextEncoder().encode('/'+file.path+'\0');
          if(name.length>1024)error(E.NAMETOOLONG);
          cpu.write(arg,name);return 0;
        }
        case 51:return 0; // Full sync: writes commit before returning.
        default:error(E.NOTSUP);
      }
    }),
    _stat: checked(async a => {
      if (!a(0) || !a(1)) error(E.FAULT);
      cpu.write(a(1), statBytes(await pathStat(locate(a(0)))));
      return 0;
    }, -1, "stat"),
    _fstat: checked(async a => {
      if (!a(1)) error(E.FAULT);
      cpu.write(a(1), statBytes(await descriptorStat(a(0))));
      return 0;
    }),
    _opendir: checked(async a => {
      if (!a(0)) error(E.FAULT);
      const entries = await directoryEntries(locate(a(0)));
      const handle = heap.zero(4 + DIRENT_BYTES);
      if (!handle) error(E.NOMEM);
      directoryStreams.set(handle, {entries, position: 0});
      return handle;
    }, 0, "opendir"),
    _readdir: checked(a => {
      const handle = a(0), dir = directoryStreams.get(handle);
      if (!dir) error(E.BADF);
      if (dir.position === dir.entries.length) return 0;
      const record = direntBytes(dir.entries[dir.position++], dir.position);
      if (!record) error(E.NAMETOOLONG);
      cpu.write(handle + 4, record);
      return handle + 4;
    }, 0),
    _closedir: checked(a => closeDirectory(a(0))),
    _fsync: checked(a => { fdFor(a(0)); return 0; }), // writes await transaction completion
    _access: checked(a => access(a(0), a(1)), -1, "access"),
    _mkdir: checked(async a => {
      const home = locate(a(0)).home;
      if (home === undefined) error(E.ROFS);
      if (!home || roots.has(home)) error(E.EXIST);
      return run("readwrite", async ({ paths, inodes }) => {
        if (await paths.get(home)) error(E.EXIST);
        await requireParent(paths, home);
        const inode = await inodes.add({dir: true, linked: true, refs: 0});
        await paths.put(home, { dir: true, inode });
        return 0;
      });
    }),
    _chdir: checked(async a => {
      const p = locate(a(0));
      if (p.bundle) {
        if (!bundleIsDir(p.bundle)) {
          if (ipa.has(p.bundle)) error(E.NOTDIR);
          missingBundlePath(p.bundle);
        }
      } else if (p.home) {
        const item = await run("readonly", ({paths}) => paths.get(p.home));
        if (!item) error(E.NOENT);
        if (!item.dir) error(E.NOTDIR);
      }
      currentDirectory = "/" + (p.bundle ?? p.home);
      return 0;
    }, -1, "chdir"),
    _getcwd: checked(a => {
      const bytes = new TextEncoder().encode(currentDirectory + "\0");
      const buffer = a(0), capacity = a(1);
      if (buffer && !capacity) error(E.INVAL);
      if (capacity && capacity < bytes.length) error(E.RANGE);
      const dest = buffer || heap.zero(capacity || bytes.length);
      if (!dest) error(E.NOMEM);
      cpu.write(dest, bytes);
      return dest;
    }, 0),
    _remove: checked(async a => {
      const p=a(0),st=await pathStat(locate(p));
      return remove(p,(st.mode&0o170000)===0o40000);
    }),
    _setxattr: checked(async a => { const path=locate(a(0)); await pathStat(path); error(path.bundle ? E.ROFS : E.NOTSUP); }),
    _getxattr: checked(async a => { await pathStat(locate(a(0))); error(93); }),
    _removexattr: checked(async a => { const path=locate(a(0)); await pathStat(path); error(path.bundle ? E.ROFS : 93); }),
    _unlink: checked(a => remove(a(0), false)), _rmdir: checked(a => remove(a(0), true)),
    _rename: checked(a => rename(a(0), a(1))),
    _chmod:checked(a=>setMetadata(a(0),{permissions:a(1)&0o7777})),
    _fopen:checked(async a=>{
      const {access,flags}=streamMode(a(1));
      return newStream(await open(a(0),flags),access);
    },0,'fopen'),
    _freopen:checked(async a=>{
      const stream=a(2),old=streamFor(stream),mode=a(1),addr=a(0);
      let path=addr;
      try {
        if(!path) {
          const entry=fdFor(old.fd);
          if(!entry.path)error(E.BADF);
          path=heap.string('/'+entry.path);
          if(!path)error(E.NOMEM);
        }
        const {access,flags}=streamMode(mode);
        await close(old.fd);streams.delete(stream);
        const fd=await open(path,flags);
        fds.set(old.fd,fdFor(fd));fds.delete(fd);closedStandard.delete(old.fd);
        return newStream(old.fd,access,stream);
      } catch(e) {
        if(streams.delete(stream))await close(old.fd);
        if(old.fd>=3)heap.free(stream);
        throw e;
      } finally {if(path&&!addr)heap.free(path);}
    },0),
    _tmpnam:checked(async a=>{
      const dest=a(0)||(tmpnameBuffer ||= heap.zero(32));
      if(!dest)error(E.NOMEM);
      for(;;) {
        const name='tmp/B'+crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
        if(await run('readonly',({paths})=>paths.get(name)))continue;
        cpu.write(dest,new TextEncoder().encode('/'+name+'\0'));return dest;
      }
    },0),
    _tmpfile:checked(async()=>{
      const now=Date.now();
      const inode=await run('readwrite',({inodes})=>inodes.add({size:0,refs:1,linked:false,permissions:0o600,created:now,modified:now}));
      const fd=next++;fds.set(fd,{mode:2,inode,offset:0,append:false});return newStream(fd,2);
    },0),
    _fread: transferStdIO(false), _fwrite: transferStdIO(true),
    _putchar:async a=>{const ch=a(0)&255;return await writeBytes(1,Uint8Array.of(ch))===1?ch:-1;},
    _puts:async a=>{const src=readCStringBytes(cpu,a(0)),bytes=new Uint8Array(src.length+1);bytes.set(src);bytes[src.length]=10;return await writeBytes(1,bytes)===bytes.length?0:-1;},
    _fputs: checked(async a => {
      const ptr=a(0),count=readCStringBytes(cpu,ptr).length;
      return await write(streamFor(a(1)).fd,ptr,count) === count ? 0 : -1;
    }),
    _fputc: checked(async a => {
      const ptr=a(1), stream=streamFor(ptr), ch=a(0)&255;
      cpu.write(ptr+64,Uint8Array.of(ch));
      return await write(stream.fd,ptr+64,1)===1 ? ch : -1;
    }),
    _getc: checked(async a => {
      const ptr=a(0), stream=streamFor(ptr);
      if (await streamRead(stream,ptr+64,1)) return cpu.read(ptr+64,1)[0];
      stream.eof=true; setStreamStatus(ptr,stream); return -1;
    }),
    _ungetc: checked(a => {
      const ptr=a(1),s=streamFor(ptr),ch=a(0)|0;
      if (ch===-1 || s.pushback!==undefined) return -1;
      s.pushback=ch&255; s.eof=false; setStreamStatus(ptr,s);
      return s.pushback;
    }),
    _rewind: checked(async a => {
      const ptr=a(0),s=streamFor(ptr);
      await seek(s.fd,0n,0); delete s.pushback;
      s.eof=s.error=false; setStreamStatus(ptr,s);
    }),
    _fgets: checked(async a => {
      const dst=a(0),limit=a(1)|0,ptr=a(2),s=streamFor(ptr);
      if (!dst || limit<1) return 0;
      let used=0;
      while (used<limit-1) {
        const count=Math.min(1024,limit-1-used), n=await streamRead(s,dst+used,count);
        if (!n) {s.eof=true;setStreamStatus(ptr,s);if (!used) return 0;break;}
        const i=cpu.read(dst+used,n).indexOf(10);
        if (i>=0) {
          used+=i+1;
          if (i+1<n) await seek(s.fd,BigInt(i+1-n),1);
          break;
        }
        used+=n;
      }
      cpu.write(dst+used,Uint8Array.of(0));return dst;
    },0),
    _setvbuf: checked(a => {
      streamFor(a(0));
      // All guest FILE writes are immediately visible on their descriptor.
      if (a(2)>2) error(E.INVAL);
      return 0;
    }),
    _fseek: checked(async a => {
      const ptr = a(0), s = streamFor(ptr);
      const adjust = s.pushback !== undefined && a(2) === 1 ? 1 : 0;
      await seek(s.fd, BigInt((a(1) | 0)-adjust), a(2));
      delete s.pushback;
      s.eof = false; setStreamStatus(ptr, s);
      return 0;
    }),
    _ftell: checked(a => {
      const stream=streamFor(a(0)), pos = fdFor(stream.fd).offset-(stream.pushback !== undefined ? 1 : 0);
      if (pos > 0x7fffffff) error(E.OVERFLOW);
      return pos;
    }),
    _feof: checked(a => Number(streamFor(a(0)).eof)), _ferror: checked(a => Number(streamFor(a(0)).error)),
    _clearerr: checked(a => { const ptr = a(0), s = streamFor(ptr); s.eof = s.error = false; setStreamStatus(ptr, s); }),
    _fflush: checked(a => { if (a(0)) streamFor(a(0)); return 0; }),
    _fileno: checked(a => streamFor(a(0)).fd),
    _fclose: checked(async a => { const ptr = a(0),fd=streamFor(ptr).fd; await close(fd); streams.delete(ptr); if(fd>=3)heap.free(ptr); return 0; })
  };
  Object.defineProperty(funcs, "setMetadata", {value:async(path,update)=>{
    const pointer=heap.string(path);
    try{await setMetadata(pointer,update);return 0;}
    catch(e){if(e instanceof FileError)return e.errno;throw e;}
    finally{heap.free(pointer);}
  }});
  Object.defineProperty(funcs, "writeBytes", {value:writeBytes});
  Object.defineProperty(funcs, "descriptors", {value:{
    get:fd=>fds.get(fd),close,
    exists:fd=>fds.has(fd)||(fd<3&&!closedStandard.has(fd)),
    install:device=>{const fd=next++;fds.set(fd,{device,mode:2,offset:0});return fd;}
  }});
  Object.defineProperty(funcs, "closeFiles", { value: async () => {
    try { for (const fd of [...fds.keys()]) if(fds.has(fd)) await close(fd); }
    finally { for (const handle of directoryStreams.keys()) closeDirectory(handle); await storage.close(); }
  }});
  return funcs;
}
