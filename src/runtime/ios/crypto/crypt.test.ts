import { expect, test } from "vite-plus/test";
import { createCipheriv } from "node:crypto";
import { crypt, CryptoStatus } from "./crypt";
function fixture() {
  const memory = new Uint8Array(4096),
    view = new DataView(memory.buffer);
  const call = crypt({
    read: (pointer, length) => memory.slice(pointer, pointer + length),
    write: (pointer, bytes) => memory.set(bytes, pointer),
    writeWord: (pointer, value) => view.setUint32(pointer, value, true),
  });
  return { memory, view, call: (...args: number[]) => call((index) => args[index] ?? 0) };
}
test("CommonCrypto AES-CBC padding matches independent native ciphers and supports in-place decryption", async () => {
  for (const size of [16, 32])
    for (const length of [0, 1, 15, 16, 31, 64]) {
      const x = fixture(),
        key = Uint8Array.from({ length: size }, (_, i) => i),
        iv = Uint8Array.from({ length: 16 }, (_, i) => i * 7),
        plain = Uint8Array.from({ length }, (_, i) => i * 31);
      x.memory.set(key, 128);
      x.memory.set(iv, 192);
      x.memory.set(plain, 256);
      const cipher = createCipheriv(`aes-${size * 8}-cbc`, key, iv),
        expected = Buffer.concat([cipher.update(plain), cipher.final()]);
      expect(await x.call(0, 0, 1, 128, size, 192, 256, length, 512, 256, 32)).toBe(0);
      expect(x.memory.slice(512, 512 + expected.length)).toEqual(new Uint8Array(expected));
      expect(x.view.getUint32(32, true)).toBe(expected.length);
      expect(
        await x.call(1, 0, 1, 128, size, 192, 512, expected.length, 512, expected.length, 32),
      ).toBe(0);
      expect(x.memory.slice(512, 512 + plain.length)).toEqual(plain);
      expect(x.view.getUint32(32, true)).toBe(plain.length);
    }
});
test("CBC buffer errors report native required capacity and do not overwrite output", async () => {
  const x = fixture();
  x.memory.fill(0xa5, 512, 576);
  x.view.setUint32(32, 123, true);
  expect(await x.call(0, 0, 1, 128, 16, 0, 256, 16, 512, 16, 32)).toBe(CryptoStatus.BufferTooSmall);
  expect(x.view.getUint32(32, true)).toBe(32);
  expect(x.memory.slice(512, 576)).toEqual(new Uint8Array(64).fill(0xa5));
  expect(await x.call(1, 0, 1, 128, 16, 0, 256, 17, 512, 64, 32)).toBe(CryptoStatus.Alignment);
  expect(await x.call(0, 0, 2, 128, 16, 0, 256, 16, 512, 64, 32)).toBe(CryptoStatus.Unimplemented);
});
test("all guest argument slots are captured before asynchronous cryptography yields", async () => {
  const x = fixture(),
    slots = [0, 0, 1, 128, 16, 0, 256, 16, 512, 64, 32];
  const work = crypt({
    read: (p, n) => x.memory.slice(p, p + n),
    write: (p, b) => x.memory.set(b, p),
    writeWord: (p, v) => x.view.setUint32(p, v, true),
  })((index) => slots[index] ?? 0);
  slots.fill(0);
  expect(await work).toBe(0);
  expect(x.view.getUint32(32, true)).toBe(32);
});

test("invalid CBC padding fails without publishing partial output", async () => {
  const x = fixture();
  expect(await x.call(0, 0, 1, 128, 16, 0, 256, 16, 512, 64, 32)).toBe(0);
  x.memory[527] = (x.memory[527] ?? 0) ^ 1;
  x.memory.fill(0xa5, 1024, 1088);
  expect(await x.call(1, 0, 1, 128, 16, 0, 512, 32, 1024, 64, 32)).toBe(CryptoStatus.Decode);
  expect(x.view.getUint32(32, true)).toBe(0);
  expect(x.memory.slice(1024, 1088)).toEqual(new Uint8Array(64).fill(0xa5));
});
