import { expect, test } from "vite-plus/test";
import { decodePVRTC } from "./pvrtc";

test("PVRTC rejects non power-of-two dimensions and wrong mip sizes before decoding", async () => {
  await expect(decodePVRTC(0x8c00, 3, 4, new Uint8Array(32))).rejects.toThrow("dimensions");
  await expect(decodePVRTC(0x8c00, 8, 8, new Uint8Array(31))).rejects.toThrow("mip size");
});
