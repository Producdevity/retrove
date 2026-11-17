import { expect, test } from "vite-plus/test";
import { crc32 } from "./crc32";

test("matches the standard CRC-32 check value and continues across chunks", () => {
  const bytes = new TextEncoder().encode("123456789");
  expect(crc32(0, bytes)).toBe(0xcbf43926);
  expect(crc32(crc32(0, bytes.subarray(0, 4)), bytes.subarray(4))).toBe(0xcbf43926);
});
