import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../../web/cpu.mjs";
import { ExecutionBudget } from "../execution-budget";

test.each([1, 2, 64])(
  "revisited hot ARM blocks recover at threshold %s",
  async (compilationThreshold) => {
    const cpu = await createCPU({ budget: ExecutionBudget.Blocks, compilationThreshold });
    const base = 0x1000,
      stride = 16,
      hot = 128,
      cold = 8192,
      stop = 0x40000,
      warmPasses = Math.max(4, compilationThreshold * 2),
      resumePasses = Math.max(64, compilationThreshold * 2);
    try {
      cpu.map(base, 0x40000);
      const code = new Uint32Array(((hot + cold) * stride) / 4);
      for (let block = 0; block < hot + cold; block++) {
        code[block * 4] = 0xe2800001;
        code[block * 4 + 1] = 0xe12fff1e;
      }
      cpu.write(base, new Uint8Array(code.buffer));
      cpu.setReg(0, 0);
      cpu.setReg(14, stop);
      const run = (block: number) => cpu.run(base + block * stride, { until: stop });
      for (let repeat = 0; repeat < warmPasses; repeat++)
        for (let block = 0; block < hot; block++) run(block);
      for (let block = hot; block < hot + cold; block++) run(block);
      for (let repeat = 0; repeat < resumePasses; repeat++)
        for (let block = 0; block < hot; block++) run(block);
      const resumed = cpu.compiler;
      for (let repeat = 0; repeat < 32; repeat++)
        for (let block = 0; block < hot; block++) run(block);
      const settled = cpu.compiler;
      if (!resumed || !settled) throw new Error("Compiler statistics missing.");
      expect(settled.executions - resumed.executions).toBeGreaterThanOrEqual(hot * 31);
      expect(settled.fallbacks - resumed.fallbacks).toBeLessThanOrEqual(
        compilationThreshold === 1 ? 0 : hot * 33,
      );
      expect(settled.functions).toBeLessThanOrEqual(4096);
      expect(settled.bytes).toBeLessThanOrEqual(8_388_608);
      expect(cpu.getReg(0)).toBe(hot * (warmPasses + resumePasses + 32) + cold);
      expect(settled.failures).toBe(0);
    } finally {
      cpu.close();
    }
  },
  60000,
);
