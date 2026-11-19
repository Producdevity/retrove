import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../web/cpu.mjs";
import { write32 } from "../memory/guest-memory";
import { BindingShadow, guestBindings } from "./guest-bindings";

const ARRAY_BUFFER = 0x8892;
const TEXTURE_2D = 0x0de1;
const TEXTURE_CUBE_MAP = 0x8513;
const TEXTURE0 = 0x84c0;

test("binding calls stay in guest code only while the shadow already holds the binding", async () => {
  const cpu = await createCPU();
  const page = 0x1000,
    shadowAddress = 0x8000,
    gate = 0x4000,
    returnTo = 0x1ffc;
  try {
    cpu.map(page, 4096);
    cpu.map(shadowAddress, 4096);
    cpu.map(gate, 4096);
    cpu.write(gate, Uint8Array.of(0xf0, 0, 0xf0, 0xe7));
    const shadow = new BindingShadow(shadowAddress, (address, value) =>
      write32(cpu, address, value),
    );
    const routines = guestBindings(cpu, { alloc: () => page }, shadowAddress, {
      bindBuffer: gate,
      activeTexture: gate,
      bindTexture: gate,
    });
    cpu.trap(gate, () => {});
    const call = (name: string, ...args: number[]) => {
      args.forEach((value, index) => cpu.setReg(index, value));
      cpu.setReg(14, returnTo);
      return cpu.run(routines.get(name) ?? 0, { until: returnTo, count: 100 }).reason;
    };
    expect(call("_glBindBuffer", ARRAY_BUFFER, 0)).toBe("trap");
    shadow.buffer(ARRAY_BUFFER, 7);
    expect(call("_glBindBuffer", ARRAY_BUFFER, 7)).toBe("until");
    expect(call("_glBindBuffer", ARRAY_BUFFER, 8)).toBe("trap");
    expect(call("_glBindBuffer", 0x8891, 7)).toBe("trap");

    expect(call("_glActiveTexture", TEXTURE0 + 1)).toBe("trap");
    shadow.activeTexture(TEXTURE0 + 1);
    expect(call("_glActiveTexture", TEXTURE0 + 1)).toBe("until");
    expect(call("_glBindTexture", TEXTURE_2D, 3)).toBe("trap");
    shadow.texture(TEXTURE_2D, 3);
    expect(call("_glBindTexture", TEXTURE_2D, 3)).toBe("until");
    expect(call("_glBindTexture", TEXTURE_CUBE_MAP, 3)).toBe("trap");
    shadow.activeTexture(TEXTURE0);
    expect(call("_glBindTexture", TEXTURE_2D, 3)).toBe("trap");

    shadow.forget();
    expect(call("_glBindBuffer", ARRAY_BUFFER, 7)).toBe("trap");
    expect(call("_glActiveTexture", TEXTURE0)).toBe("trap");
  } finally {
    cpu.close();
  }
});
