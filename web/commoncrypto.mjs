import {crypt} from "../src/runtime/ios/crypto/crypt.ts";
import {write32} from "./memory.mjs";
import {md5, sha1} from './vendor/noble-hashes/legacy.js';
import {sha224, sha256, sha384, sha512} from './vendor/noble-hashes/sha2.js';

const algorithms = [sha1, md5, sha256, sha384, sha512, sha224];
// Store both compression states and the unfinished inner block in guest memory.
// iOS CCHmacContext is 384 bytes and callers may copy an active context.
const contextBytes = 272;
export function commonCrypto(cpu, heap) {
  let staticSHA1;
  function feed(hash, address, length) {
    for (let i = 0; i < length; i += 65536)
      hash.update(cpu.read(address + i, Math.min(length - i, 65536)));
    return hash;
  }
  function initialize(algorithm, key, size) {
    const hash = algorithms[algorithm];
    if (!hash) throw Error('Unknown CCHmac algorithm ' + algorithm);
    const pad = new Uint8Array(hash.blockLen);
    pad.set(size > pad.length ? feed(hash.create(), key, size).digest() : cpu.read(key, size));
    for (let i=0; i<pad.length; i++) pad[i] ^= 0x36;
    const inner = hash.create().update(pad);
    for (let i=0; i<pad.length; i++) pad[i] ^= 0x36 ^ 0x5c;
    return {algorithm, inner, outer: hash.create().update(pad)};
  }
  function store(address, {algorithm, inner, outer}) {
    const bytes = new Uint8Array(contextBytes), v = new DataView(bytes.buffer);
    v.setUint32(0, algorithm, true); v.setFloat64(8, inner.length, true);
    for (const [hash, start] of [[inner, 16], [outer, 80]])
      hash.get().forEach((word, i) => v.setUint32(start + 4*i, word, true));
    bytes.set(inner.buffer.subarray(0,inner.pos), 144);
    cpu.write(address, bytes);
  }
  function read(address) {
    const bytes = cpu.read(address, contextBytes);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const algorithm = v.getUint32(0, true), hash = algorithms[algorithm];
    if (!hash) throw Error('Invalid CCHmac context');
    const inner = hash.create(), outer = hash.create();
    for (const [state, start] of [[inner, 16], [outer, 80]])
      state.set(...state.get().map((_, i) => v.getUint32(start + i*4, true)));
    inner.length = v.getFloat64(8, true); inner.pos = inner.length % inner.blockLen;
    outer.length = outer.blockLen; inner.buffer.set(bytes.subarray(144, 144 + inner.pos));
    return {algorithm, inner, outer};
  }
  function finish({inner, outer}, address) {
    cpu.write(address, outer.update(inner.digest()).digest());
  }
  return {
    _CCCrypt:crypt({read:(p,n)=>cpu.read(p,n),write:(p,b)=>cpu.write(p,b),writeWord:(p,v)=>write32(cpu,p,v)}),
    _CC_SHA1: a => {
      const output = a(2) || (staticSHA1 ??= heap.alloc(20));
      cpu.write(output, feed(sha1.create(), a(0), a(1)).digest()); return output;
    },
    _CCHmac: a => { const h=initialize(a(0),a(1),a(2)); feed(h.inner,a(3),a(4)); finish(h,a(5)); },
    _CCHmacInit: a => store(a(0),initialize(a(1),a(2),a(3))),
    _CCHmacUpdate: a => { const h=read(a(0)); feed(h.inner,a(1),a(2)); store(a(0),h); },
    _CCHmacFinal: a => { const h=read(a(0)); finish(h,a(1)); }
  };
}
