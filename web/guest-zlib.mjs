import {read32, write32} from '../src/runtime/memory/guest-memory.ts';

export function guestZlibStreams(cpu, heap, hostGate) {
  let installed;
  async function install() {
    const {base64, segments, relocations, entries} = await import('./vendor/zlib-arm.mjs');
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const base = heap.alloc(bytes.length, 4096);
    if (!base) throw Error('Guest heap exhausted loading zlib');
    const view = new DataView(bytes.buffer);
    for (const at of relocations) view.setUint32(at, base + view.getUint32(at, true), true);
    cpu.write(base, bytes);
    for (const [offset, length, permissions] of segments) cpu.protect(base + offset, length, permissions);
    return Object.fromEntries(Object.entries(entries).map(([name, offset]) => [name, base + offset]));
  }
  function defaults(stream) {
    // z_stream from Darwin ARM32 stores zalloc, zfree and opaque at 32, 36 and 40.
    if (!read32(cpu, stream + 32)) {
      const allocate = args => heap.zero(args(1) * args(2));
      write32(cpu, stream + 32, hostGate({library: 'libz', name: 'zcalloc'}, allocate));
      write32(cpu, stream + 40, 0);
    }
    if (!read32(cpu, stream + 36)) {
      const release = args => heap.free(args(1));
      write32(cpu, stream + 36, hostGate({library: 'libz', name: 'zcfree'}, release));
    }
  }
  const funcs = {};
  for (const name of ['inflateInit2_', 'deflateInit2_', 'inflate', 'deflate', 'inflateEnd', 'deflateEnd']) {
    funcs['_' + name] = async a => {
      const entries = await (installed ??= install());
      if (name === 'inflateInit2_' || name === 'deflateInit2_') {
        const vi = name === 'inflateInit2_' ? 2 : 6;
        if (!a(vi) || a(vi + 1) !== 56 || cpu.read(a(vi), 1)[0] !== 49) return -6;
        if (!a(0)) return -2;
        defaults(a(0));
      }
      return {jump: entries[name]};
    };
  }
  return funcs;
}
