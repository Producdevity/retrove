import { expect, test } from "vite-plus/test";
import { compressedFileType, decodedAudioFile } from "./decoded";

const tag = (value: string) => new DataView(new TextEncoder().encode(value).buffer).getUint32(0);

test("MPEG-4 and MPEG audio are recognised by their headers", () => {
  const mp4 = new Uint8Array([0, 0, 0, 32, ...new TextEncoder().encode("ftypM4A ")]);
  expect(compressedFileType(mp4)).toBe(tag("m4af"));
  expect(compressedFileType(new TextEncoder().encode("ID3\u0003"))).toBe(tag("MPG3"));
  expect(compressedFileType(new Uint8Array([0xff, 0xfb, 0x90, 0]))).toBe(tag("MPG3"));
  expect(compressedFileType(new TextEncoder().encode("caff"))).toBeUndefined();
});

test("a decoded file reads back as interleaved 16-bit PCM packets", async () => {
  const left = Float32Array.of(0, 1, -1),
    right = Float32Array.of(0.5, -0.5, 2);
  const file = await decodedAudioFile(new Uint8Array(4), tag("m4af"), () =>
    Promise.resolve({
      sampleRate: 22050,
      numberOfChannels: 2,
      length: 3,
      getChannelData: (channel: number) => (channel ? right : left),
    }),
  );
  expect([file.count, file.packetBytes, file.dataSize]).toEqual([3, 4, 12]);
  const view = new DataView((await file.read(4, 8)).buffer);
  expect([view.getInt16(0, true), view.getInt16(2, true), view.getInt16(6, true)]).toEqual([
    32767, -16383, 32767,
  ]);
  const format = file.props.get(tag("dfmt"));
  expect(format && new DataView(format.buffer).getUint32(8, true)).toBe(tag("lpcm"));
});
