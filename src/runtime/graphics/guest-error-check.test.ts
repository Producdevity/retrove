import { expect, test } from "vite-plus/test";
import { createCPU } from "../cpu/cpu";
import { guestErrorCheck } from "./guest-error-check";

test("glGetError stays in guest code until the flag asks the host", async () => {
  const cpu = await createCPU();
  const page = 0x1000,
    flag = 0x8000,
    gate = 0x4000,
    returnTo = 0x1ffc;
  try {
    cpu.map(page, 4096);
    cpu.map(flag, 4096);
    cpu.map(gate, 4096);
    cpu.write(gate, Uint8Array.of(0xf0, 0, 0xf0, 0xe7));
    const check = guestErrorCheck(cpu, { alloc: () => page }, flag, gate);
    let asked = false;
    cpu.trap(gate, () => {
      asked = true;
    });
    const call = () => {
      cpu.setReg(0, 0x1234);
      cpu.setReg(14, returnTo);
      return cpu.run(check, { until: returnTo, count: 100 }).reason;
    };
    expect(call()).toBe("until");
    expect(cpu.getReg(0)).toBe(0);
    expect(asked).toBe(false);
    cpu.write(flag, Uint8Array.of(1, 0, 0, 0));
    expect(call()).toBe("trap");
    expect(asked).toBe(true);
  } finally {
    cpu.close();
  }
});
