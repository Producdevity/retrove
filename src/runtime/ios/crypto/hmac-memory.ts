import { md5, sha1 } from "../../../../web/vendor/noble-hashes/legacy.js";
import type { Hasher, MerkleHash } from "../../../../web/vendor/noble-hashes/hash";
import { sha224, sha256, sha384, sha512 } from "../../../../web/vendor/noble-hashes/sha2.js";
import type { GuestMemory } from "../../memory/guest-memory";

export const algorithms: readonly Hasher[] = [sha1, md5, sha256, sha384, sha512, sha224];
/** Both compression states and the unfinished inner block live in guest memory; callers may copy an active CCHmacContext. */
const CONTEXT_BYTES = 272;
const Context = { Algorithm: 0, Length: 8, Inner: 16, Outer: 80, Block: 144 } as const;
const WORD_BYTES = 4;
const FEED_CHUNK = 65_536;
const INNER_PAD = 0x36;
const OUTER_PAD = 0x5c;

export interface HmacState {
  readonly algorithm: number;
  readonly inner: MerkleHash;
  readonly outer: MerkleHash;
}
export interface Hmac {
  readonly feed: (hash: MerkleHash, address: number, length: number) => MerkleHash;
  readonly initialize: (algorithm: number, key: number, size: number) => HmacState;
  readonly store: (address: number, state: HmacState) => void;
  readonly read: (address: number) => HmacState;
  readonly finish: (state: HmacState, address: number) => void;
}

/** HMAC state kept in guest memory, in the layout of iOS CCHmacContext. */
export function hmacMemory(cpu: GuestMemory): Hmac {
  function feed(hash: MerkleHash, address: number, length: number): MerkleHash {
    for (let i = 0; i < length; i += FEED_CHUNK)
      hash.update(cpu.read(address + i, Math.min(length - i, FEED_CHUNK)));
    return hash;
  }
  function initialize(algorithm: number, key: number, size: number): HmacState {
    const hash = algorithms[algorithm];
    if (!hash) throw new Error(`Unknown CCHmac algorithm ${algorithm}`);
    const pad = new Uint8Array(hash.blockLen);
    pad.set(size > pad.length ? feed(hash.create(), key, size).digest() : cpu.read(key, size));
    for (let i = 0; i < pad.length; i++) pad[i] = (pad[i] ?? 0) ^ INNER_PAD;
    const inner = hash.create().update(pad);
    for (let i = 0; i < pad.length; i++) pad[i] = (pad[i] ?? 0) ^ INNER_PAD ^ OUTER_PAD;
    return { algorithm, inner, outer: hash.create().update(pad) };
  }
  function store(address: number, { algorithm, inner, outer }: HmacState): void {
    const bytes = new Uint8Array(CONTEXT_BYTES),
      view = new DataView(bytes.buffer);
    view.setUint32(Context.Algorithm, algorithm, true);
    view.setFloat64(Context.Length, inner.length, true);
    for (const [hash, start] of [
      [inner, Context.Inner],
      [outer, Context.Outer],
    ] as const)
      hash.get().forEach((word, i) => view.setUint32(start + WORD_BYTES * i, word, true));
    bytes.set(inner.buffer.subarray(0, inner.pos), Context.Block);
    cpu.write(address, bytes);
  }
  function read(address: number): HmacState {
    const bytes = cpu.read(address, CONTEXT_BYTES);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const algorithm = view.getUint32(Context.Algorithm, true),
      hash = algorithms[algorithm];
    if (!hash) throw new Error("Invalid CCHmac context");
    const inner = hash.create(),
      outer = hash.create();
    for (const [state, start] of [
      [inner, Context.Inner],
      [outer, Context.Outer],
    ] as const)
      state.set(...state.get().map((_, i) => view.getUint32(start + i * WORD_BYTES, true)));
    inner.length = view.getFloat64(Context.Length, true);
    inner.pos = inner.length % inner.blockLen;
    outer.length = outer.blockLen;
    inner.buffer.set(bytes.subarray(Context.Block, Context.Block + inner.pos));
    return { algorithm, inner, outer };
  }
  function finish({ inner, outer }: HmacState, address: number): void {
    cpu.write(address, outer.update(inner.digest()).digest());
  }
  return { feed, initialize, store, read, finish };
}
