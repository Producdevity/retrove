import { expect, test } from "vite-plus/test";
import { decodePCM } from "./pcm";
import { PCMFormat } from "./constants";
test("OpenAL PCM uses unsigned 8-bit and signed little-endian 16-bit interleaved samples", () => {
  expect([
    ...(decodePCM(PCMFormat.Mono8, Uint8Array.of(0, 128, 255), 8000).channels[0] ?? []),
  ]).toEqual([-1, 0, 127 / 128]);
  const pcm = decodePCM(PCMFormat.Stereo16, Uint8Array.of(0, 128, 255, 127, 0, 0, 0, 64), 8000);
  expect([...(pcm.channels[0] ?? [])]).toEqual([-1, 0]);
  expect([...(pcm.channels[1] ?? [])]).toEqual([32767 / 32768, 0.5]);
  expect(pcm.duration).toBe(2 / 8000);
  expect(() => decodePCM(PCMFormat.Stereo16, Uint8Array.of(0), 8000)).toThrow();
});
