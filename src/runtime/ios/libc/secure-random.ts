import type { GuestArguments } from "../objc/host";
const RANDOM_POOL_WORDS = 256;
const WEB_CRYPTO_QUOTA_BYTES = 65536;
const UINT32_SPAN = 0x100000000;
export type EntropyView = Uint8Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
export type EntropySource = (values: EntropyView) => void;
interface RandomHost {
  write(pointer: number, bytes: Uint8Array): void;
}
function browserEntropy(values: EntropyView): void {
  const source = globalThis.crypto;
  if (!source) throw new Error("Secure random source unavailable.");
  source.getRandomValues(values);
}
class SecureRandom {
  private readonly words = new Uint32Array(RANDOM_POOL_WORDS);
  private position = RANDOM_POOL_WORDS;
  constructor(private readonly entropy: EntropySource) {}
  next(): number {
    if (this.position === this.words.length) {
      this.entropy(this.words);
      this.position = 0;
    }
    const index = this.position++,
      word = this.words[index];
    if (word === undefined) throw new Error("Secure random pool outside bounds.");
    this.words[index] = 0;
    return word;
  }
  uniform(upper: number): number {
    if (upper <= 1) return 0;
    const threshold = (UINT32_SPAN - upper) % upper;
    let word: number;
    do {
      word = this.next();
    } while (word < threshold);
    return word % upper;
  }
}
export function secureRandomImports(host: RandomHost, entropy: EntropySource = browserEntropy) {
  const random = new SecureRandom(entropy);
  return {
    _arc4random: () => random.next(),
    _arc4random_uniform: (args: GuestArguments) => random.uniform(args(0) >>> 0),
    _arc4random_buf: (args: GuestArguments): void => {
      const destination = args(0) >>> 0,
        length = args(1) >>> 0;
      if (destination + length > UINT32_SPAN)
        throw new RangeError("Random output exceeds guest address space.");
      const buffer = new Uint8Array(Math.min(length, WEB_CRYPTO_QUOTA_BYTES));
      for (let offset = 0; offset < length; offset += buffer.length) {
        const bytes = buffer.subarray(0, Math.min(buffer.length, length - offset));
        entropy(bytes);
        host.write(destination + offset, bytes);
      }
    },
  };
}
