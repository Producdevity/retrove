import { expect, test } from "vite-plus/test";
import { MpegSynthesisLayout, synthesizeMpeg } from "./mpeg-synthesis";
function fixture() {
  const input = new Uint8Array(MpegSynthesisLayout.InputBytes);
  const window = new Uint8Array(MpegSynthesisLayout.WindowBytes);
  const output = new Uint8Array(128).fill(0xa5);
  const history = new DataView(input.buffer),
    coefficients = new DataView(window.buffer);
  for (let offset = 0; offset < input.length; offset += 4) history.setFloat32(offset, 1, true);
  for (let offset = 0; offset < window.length; offset += 4)
    coefficients.setFloat32(offset, 1, true);
  return { input, window, output, history, coefficients };
}
test("MPEG synthesis keeps the other stereo channel and clips its signed output", () => {
  const f = fixture();
  synthesizeMpeg(f.input, f.window, 0, 2, f.output);
  const result = new DataView(f.output.buffer);
  for (let sample = 0; sample < 32; sample++) {
    expect(result.getInt16(sample * 4, true)).toBe(
      sample < 16 ? 0 : sample === 16 ? 32767 : -32768,
    );
    expect(result.getUint16(sample * 4 + 2, true)).toBe(0xa5a5);
  }
});
test("MPEG synthesis normalizes invalid floats and rejects invalid extents before writing", () => {
  const f = fixture();
  f.input.fill(0xff);
  synthesizeMpeg(f.input, f.window, 15, 1, f.output);
  expect(f.output.subarray(0, 64)).toEqual(new Uint8Array(64));
  const before = f.output.slice();
  for (const phase of [-1, 16, NaN, 0.5])
    expect(() => synthesizeMpeg(f.input, f.window, phase, 1, f.output)).toThrow(RangeError);
  for (const channels of [0, 3, NaN])
    expect(() => synthesizeMpeg(f.input, f.window, 0, channels, f.output)).toThrow(RangeError);
  expect(() => synthesizeMpeg(f.input.subarray(4), f.window, 0, 2, f.output)).toThrow(RangeError);
  expect(() => synthesizeMpeg(f.input, f.window.subarray(4), 0, 2, f.output)).toThrow(RangeError);
  expect(() => synthesizeMpeg(f.input, f.window, 0, 2, f.output.subarray(4))).toThrow(RangeError);
  expect(f.output).toEqual(before);
});
