import type { GuestArguments } from "../objc/host";
const CHUNK_BYTES = 65_536;
const Algorithms = {
  _CC_MD5: "md5",
  _CC_SHA1: "sha1",
  _CC_SHA224: "sha224",
  _CC_SHA256: "sha256",
  _CC_SHA384: "sha384",
  _CC_SHA512: "sha512",
} as const;
type DigestAlgorithm = (typeof Algorithms)[keyof typeof Algorithms];
interface Digest {
  update(bytes: Uint8Array): Digest;
  digest(): Uint8Array;
}
interface DigestHost {
  read(pointer: number, bytes: number): Uint8Array;
  write(pointer: number, bytes: Uint8Array): void;
  allocate(bytes: number): number;
  create(algorithm: DigestAlgorithm): Digest;
}
const Argument = { Input: 0, Length: 1, Output: 2 } as const;
export function singleShotDigests(
  host: DigestHost,
): Record<string, (args: GuestArguments) => number> {
  return Object.fromEntries(
    Object.entries(Algorithms).map(([name, algorithm]) => {
      let buffer = 0;
      return [
        name,
        (args: GuestArguments): number => {
          const input = args(Argument.Input),
            length = args(Argument.Length),
            output = args(Argument.Output),
            hash = host.create(algorithm);
          for (let offset = 0; offset < length; offset += CHUNK_BYTES)
            hash.update(host.read(input + offset, Math.min(CHUNK_BYTES, length - offset)));
          const result = hash.digest();
          if (!output && !buffer) buffer = host.allocate(result.length);
          const destination = output || buffer;
          if (!destination) throw new Error("Unable to allocate CommonCrypto digest output.");
          host.write(destination, result);
          return destination;
        },
      ];
    }),
  );
}
