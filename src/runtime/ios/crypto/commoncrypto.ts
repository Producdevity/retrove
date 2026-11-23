import type { GuestArguments } from "../objc/host";
import { crypt } from "./crypt";
import { hmacMemory } from "./hmac-memory";
import { singleShotDigests } from "./single-shot";
import { write32, type GuestMemory, type Heap } from "../../memory/guest-memory";
import { md5, sha1 } from "../../../../web/vendor/noble-hashes/legacy.js";
import { sha224, sha256, sha384, sha512 } from "../../../../web/vendor/noble-hashes/sha2.js";

const hashes = { md5, sha1, sha224, sha256, sha384, sha512 };
const Argument = { First: 0, Second: 1, Third: 2, Fourth: 3, Fifth: 4, Sixth: 5 } as const;

export function commonCrypto(
  cpu: GuestMemory,
  heap: Pick<Heap, "alloc">,
): Record<string, (a: GuestArguments) => number | void | Promise<number>> {
  const { feed, initialize, store, read, finish } = hmacMemory(cpu);
  const memory = {
    read: (pointer: number, bytes: number) => cpu.read(pointer, bytes),
    write: (pointer: number, bytes: Uint8Array) => cpu.write(pointer, bytes),
  };
  return {
    ...singleShotDigests({
      ...memory,
      allocate: (bytes) => heap.alloc(bytes),
      create: (name) => hashes[name].create(),
    }),
    _CCCrypt: crypt({ ...memory, writeWord: (pointer, value) => write32(cpu, pointer, value) }),
    _CCHmac: (a) => {
      const state = initialize(a(Argument.First), a(Argument.Second), a(Argument.Third));
      feed(state.inner, a(Argument.Fourth), a(Argument.Fifth));
      finish(state, a(Argument.Sixth));
    },
    _CCHmacInit: (a) =>
      store(
        a(Argument.First),
        initialize(a(Argument.Second), a(Argument.Third), a(Argument.Fourth)),
      ),
    _CCHmacUpdate: (a) => {
      const state = read(a(Argument.First));
      feed(state.inner, a(Argument.Second), a(Argument.Third));
      store(a(Argument.First), state);
    },
    _CCHmacFinal: (a) => finish(read(a(Argument.First)), a(Argument.Second)),
  };
}
