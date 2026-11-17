import { expect, test } from "vite-plus/test";
import { fixupStream, type FixupImage } from "../../../../web/macho.mjs";

const name = [...new TextEncoder().encode("_malloc"), 0];
// ordinal 1, symbol _malloc, pointer type, segment 0 offset 0, bind once
const binds = [0x11, 0x40, ...name, 0x51, 0x70, 0x00, 0x90];

function image(): FixupImage {
  return {
    segments: [{ name: "__DATA", address: 0x1000, size: 0x100 }],
    dylibs: ["/usr/lib/libSystem.B.dylib"],
    imports: [],
    rebases: [],
  };
}

test("bind streams may end without DONE, as dyld accepts", () => {
  for (const bytes of [binds, [...binds, 0x00]]) {
    const target = image();
    fixupStream(Uint8Array.from(bytes), target, "normal");
    expect(target.imports.map((bind) => [bind.address, bind.name])).toEqual([[0x1000, "_malloc"]]);
  }
});
