import { describe, expect, it } from "vite-plus/test";
import { callTargets } from "./call-targets";

const base = 0x1000;
function code(words: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((word, index) => view.setUint32(index * 4, word, true));
  return bytes;
}
/** ARM `bl` from `from` to `to`. */
const bl = (from: number, to: number) => (0xeb000000 | (((to - from - 8) >> 2) & 0xffffff)) >>> 0;

describe("call target scan", () => {
  it("keeps targets with a prologue or several callers and drops one-off stray calls", () => {
    const words = new Array<number>(0x80).fill(0xe1a00000);
    words[0] = bl(base, base + 0x100);
    words[1] = bl(base + 4, base + 0x180);
    words[2] = bl(base + 8, base + 0x180);
    words[3] = bl(base + 12, base + 0x1c0);
    words[0x40] = 0xe92d4010; // push {r4, lr}
    // Thumb bl at 0x1010 to the Thumb function at 0x1100 + 0x40 = 0x1140.
    const thumbOffset = 0x1140 - (base + 0x10 + 4);
    words[4] =
      (0xf000 | ((thumbOffset >> 12) & 0x7ff) | ((0xf800 | ((thumbOffset >> 1) & 0x7ff)) << 16)) >>>
      0;
    words[0x50] = 0x0000b510; // push {r4, lr}
    expect(callTargets(code(words), base)).toEqual([0x1100, 0x1141, 0x1180]);
  });
});
