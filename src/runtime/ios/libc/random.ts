import type { GuestArguments } from "../objc/host";
const STATE_WORDS = 31;
const SEPARATION = 3;
const WARMUP_CYCLES = 10;
const MULTIPLIER = 16807;
const MODULUS = 2147483647;
const ZERO_SEED_REPLACEMENT = 123459876;
export class DarwinRandom {
  private readonly state = new Uint32Array(STATE_WORDS);
  private front = SEPARATION;
  private rear = 0;
  constructor(seed = 1) {
    this.seed(seed);
  }
  seed(value: number): void {
    this.state[0] = value >>> 0;
    for (let index = 1; index < STATE_WORDS; index++) {
      const previous = this.word(index - 1) | 0;
      const next = ((previous || ZERO_SEED_REPLACEMENT) * MULTIPLIER) % MODULUS;
      this.state[index] = next < 0 ? next + MODULUS : next;
    }
    this.front = SEPARATION;
    this.rear = 0;
    for (let index = 0; index < STATE_WORDS * WARMUP_CYCLES; index++) this.next();
  }
  next(): number {
    const value = (this.word(this.front) + this.word(this.rear)) >>> 0;
    this.state[this.front] = value;
    this.front = (this.front + 1) % STATE_WORDS;
    this.rear = (this.rear + 1) % STATE_WORDS;
    return value >>> 1;
  }
  private word(index: number): number {
    const value = this.state[index];
    if (value === undefined) throw new Error("Random generator index outside state.");
    return value;
  }
}
export function randomImports() {
  const random = new DarwinRandom();
  return {
    _srandom: (args: GuestArguments): void => {
      random.seed(args(0));
    },
    _random: (): number => random.next(),
  };
}
