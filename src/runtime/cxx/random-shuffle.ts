import type { GuestArguments, HostWait } from "../ios/objc/host";

const STATE_WORDS = 624;
const SEED = 5489;
const INIT_MULTIPLIER = 1812433253;
const INIT_SHIFT = 30;
const SHIFT_OFFSET = 397;
const UPPER_BIT = 0x8000_0000;
const LOWER_BITS = 0x7fff_ffff;
const MATRIX = 0x9908_b0df;
const Temper = {
  FirstShift: 11,
  SecondShift: 7,
  SecondMask: 0x9d2c_5680,
  ThirdShift: 15,
  ThirdMask: 0xefc6_0000,
  FinalShift: 18,
} as const;

type RandomImport = (a: GuestArguments) => number | void | HostWait;

/** libc++ random_shuffle uses one mutex-protected, default-seeded mt19937. */
export function randomShuffleImports(currentThread: () => number): Record<string, RandomImport> {
  const mt = new Uint32Array(STATE_WORDS);
  mt[0] = SEED;
  for (let i = 1; i < mt.length; i++) {
    const previous = mt[i - 1] ?? 0;
    mt[i] = Math.imul(INIT_MULTIPLIER, previous ^ (previous >>> INIT_SHIFT)) + i;
  }
  let index = mt.length,
    randomOwner = 0;
  function twist(): void {
    for (let i = 0; i < mt.length; i++) {
      const x = ((mt[i] ?? 0) & UPPER_BIT) | ((mt[(i + 1) % STATE_WORDS] ?? 0) & LOWER_BITS);
      mt[i] = (mt[(i + SHIFT_OFFSET) % STATE_WORDS] ?? 0) ^ (x >>> 1) ^ (x & 1 ? MATRIX : 0);
    }
    index = 0;
  }
  return {
    __ZNSt3__18__rs_getEv: (a) => {
      const owner = currentThread(),
        result = a(0);
      const take = (): number | undefined => {
        if (randomOwner) return undefined;
        randomOwner = owner;
        return result;
      };
      return take() ?? { wait: take };
    },
    __ZNSt3__112__rs_defaultD1Ev: () => {
      if (randomOwner !== currentThread())
        throw new Error("Guest released a random generator on the wrong thread");
      randomOwner = 0;
    },
    __ZNSt3__112__rs_defaultclEv: () => {
      if (index === mt.length) twist();
      let x = mt[index++] ?? 0;
      x ^= x >>> Temper.FirstShift;
      x ^= (x << Temper.SecondShift) & Temper.SecondMask;
      x ^= (x << Temper.ThirdShift) & Temper.ThirdMask;
      return (x ^ (x >>> Temper.FinalShift)) >>> 0;
    },
  };
}
