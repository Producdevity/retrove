import { expect, test } from "vite-plus/test";
import { DrawableFormat, drawableStorageFormat } from "./drawable-format";
test("WebGL1 uses RGBA4 even when a browser exposes the unsupported RGBA8 enum", () => {
  const formats = { RGBA4: 0x8056, RGBA8: 0x8058, RGB565: 0x8d62 };
  expect(drawableStorageFormat(formats)).toBe(formats.RGBA4);
  expect(drawableStorageFormat({ ...formats, blitFramebuffer: () => {} })).toBe(formats.RGBA8);
  expect(drawableStorageFormat(formats, DrawableFormat.RGB565)).toBe(formats.RGB565);
  expect(() => drawableStorageFormat(formats, "unknown")).toThrow("Unsupported EAGL");
});
