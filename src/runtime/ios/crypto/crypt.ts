import type { GuestArguments } from "../objc/host";
export const CryptoStatus = {
  Success: 0,
  Parameter: -4300,
  BufferTooSmall: -4301,
  Memory: -4302,
  Alignment: -4303,
  Decode: -4304,
  Unimplemented: -4305,
} as const;
const Operation = { Encrypt: 0, Decrypt: 1 } as const;
const Algorithm = { AES: 0 } as const;
const Option = { PKCS7: 1 } as const;
const Argument = {
  Operation: 0,
  Algorithm: 1,
  Options: 2,
  Key: 3,
  KeyLength: 4,
  IV: 5,
  Input: 6,
  InputLength: 7,
  Output: 8,
  Capacity: 9,
  Moved: 10,
} as const;
const AES_BLOCK_BYTES = 16;
const KeySize = { AES128: 16, AES192: 24, AES256: 32 } as const;
const KEY_BYTES: ReadonlySet<number> = new Set(Object.values(KeySize));
const MAX_CRYPTO_BYTES = 268_435_456;
interface CryptoHost {
  read(pointer: number, bytes: number): Uint8Array;
  write(pointer: number, bytes: Uint8Array): void;
  writeWord(pointer: number, value: number): void;
}
export function crypt(host: CryptoHost, subtle: SubtleCrypto = globalThis.crypto.subtle) {
  return async (args: GuestArguments): Promise<number> => {
    const operation = args(Argument.Operation),
      algorithm = args(Argument.Algorithm),
      options = args(Argument.Options);
    const keyPointer = args(Argument.Key),
      keyLength = args(Argument.KeyLength),
      ivPointer = args(Argument.IV);
    const inputPointer = args(Argument.Input),
      length = args(Argument.InputLength),
      output = args(Argument.Output),
      capacity = args(Argument.Capacity),
      moved = args(Argument.Moved);
    if (
      !keyPointer ||
      !output ||
      (!inputPointer && length) ||
      !KEY_BYTES.has(keyLength) ||
      (operation !== Operation.Encrypt && operation !== Operation.Decrypt)
    )
      return CryptoStatus.Parameter;
    if (moved) host.writeWord(moved, 0);
    if (algorithm !== Algorithm.AES || options !== Option.PKCS7) return CryptoStatus.Unimplemented;
    if (length > MAX_CRYPTO_BYTES) return CryptoStatus.Memory;
    if (operation === Operation.Decrypt && (!length || length % AES_BLOCK_BYTES))
      return CryptoStatus.Alignment;
    const required =
      operation === Operation.Encrypt
        ? (Math.floor(length / AES_BLOCK_BYTES) + 1) * AES_BLOCK_BYTES
        : length;
    if (capacity < required) {
      if (moved) host.writeWord(moved, required);
      return CryptoStatus.BufferTooSmall;
    }
    const key = Uint8Array.from(host.read(keyPointer, keyLength)),
      input = Uint8Array.from(length ? host.read(inputPointer, length) : []);
    const iv = ivPointer
      ? Uint8Array.from(host.read(ivPointer, AES_BLOCK_BYTES))
      : new Uint8Array(AES_BLOCK_BYTES);
    try {
      const imported = await subtle.importKey("raw", key, { name: "AES-CBC" }, false, [
        "encrypt",
        "decrypt",
      ]);
      const result =
        operation === Operation.Encrypt
          ? await subtle.encrypt({ name: "AES-CBC", iv }, imported, input)
          : await subtle.decrypt({ name: "AES-CBC", iv }, imported, input);
      const bytes = new Uint8Array(result);
      host.write(output, bytes);
      if (moved) host.writeWord(moved, bytes.length);
      return CryptoStatus.Success;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotSupportedError")
        return CryptoStatus.Unimplemented;
      if (error instanceof DOMException && error.name === "OperationError")
        return CryptoStatus.Decode;
      throw error;
    } finally {
      key.fill(0);
    }
  };
}
