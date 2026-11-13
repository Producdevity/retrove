import { expect, test } from "vite-plus/test";
import { createCPU } from "../../../../web/cpu.mjs";
import { ExecutionBudget } from "../execution-budget";
const words = (...values: number[]) => new Uint8Array(Uint32Array.from(values).buffer);

test("compiled execution retains hooks, self-modified code and precise memory fault PCs", async () => {
  for (const compilationThreshold of [0, 1]) {
    const cpu = await createCPU({ budget: ExecutionBudget.Blocks, compilationThreshold });
    try {
      cpu.map(0x1000, 4096);
      cpu.map(0x8000, 4096, 3);
      cpu.write(0x1000, words(0xe2800001, 0xe5921000, 0xe5810000, 0xe12fff1e));
      cpu.setReg(14, 0x1ffc);
      cpu.setReg(0, 40);
      cpu.setReg(2, 0x8000);
      cpu.write(0x8000, words(0x8004));
      expect(cpu.run(0x1000, { until: 0x1ffc }).reason).toBe("until");
      expect(cpu.read(0x8004, 4)).toEqual(words(41));
      cpu.setReg(2, 0xdead0000);
      expect(() => cpu.run(0x1000, { until: 0x1ffc })).toThrow(/UC_ERR_READ_UNMAPPED/);
      expect(cpu.getReg(0)).toBe(42);
      expect(cpu.getReg(15)).toBe(0x1004);
      cpu.setReg(2, 0x8000);
      cpu.write(0x1000, words(0xe2800007));
      cpu.run(0x1000, { until: 0x1ffc });
      expect(cpu.read(0x8004, 4)).toEqual(words(49));
      cpu.write(0x1100, words(0xe5812000, 0xf57ff04f, 0xf57ff06f, 0xe2800001, 0xe12fff1e));
      cpu.setReg(1, 0x110c);
      cpu.setReg(2, 0xe2800009);
      cpu.run(0x1100, { until: 0x1ffc });
      expect(cpu.getReg(0)).toBe(58);
      let calls = 0;
      const remove = cpu.trap(0x110c, () => {
        calls++;
      });
      expect(cpu.run(0x1100, { until: 0x1ffc }).reason).toBe("trap");
      expect(calls).toBe(1);
      expect(cpu.getReg(0)).toBe(58);
      remove();
      if (compilationThreshold) {
        expect(cpu.compiler?.executions).toBeGreaterThan(0);
        expect(cpu.compiler?.failures).toBe(0);
      }
    } finally {
      cpu.close();
    }
  }
});

test("compiled blocks survive memory growth, repeated engine disposal and context reuse", async () => {
  for (let iteration = 0; iteration < 3; iteration++) {
    const cpu = await createCPU({ compilationThreshold: 1 });
    try {
      cpu.map(0x1000, 4096);
      cpu.write(0x1000, words(0xe2800001, 0xe12fff1e));
      cpu.setReg(0, 0);
      cpu.setReg(14, 0x1ffc);
      cpu.run(0x1000, { until: 0x1ffc });
      const saved = cpu.saveState();
      cpu.map(0x100000, 32 * 1024 * 1024, 3);
      cpu.run(0x1000, { until: 0x1ffc });
      expect(cpu.getReg(0)).toBe(2);
      cpu.restoreState(saved);
      cpu.freeState(saved);
      cpu.run(0x1000, { until: 0x1ffc });
      expect(cpu.getReg(0)).toBe(2);
      expect(cpu.compiler?.executions).toBeGreaterThan(0);
      expect(cpu.compiler?.functions).toBeGreaterThan(0);
      expect(cpu.compiler?.failures).toBe(0);
    } finally {
      cpu.close();
    }
    expect(cpu.compiler?.functions).toBe(0);
    expect(cpu.compiler?.bytes).toBe(0);
    cpu.close();
  }
});

test("warm compiled loops return through cold interpreted ARM and Thumb blocks", async () => {
  for (const compilationThreshold of [1, 2, 8, 64]) {
    const cpu = await createCPU({ budget: ExecutionBudget.Blocks, compilationThreshold });
    try {
      cpu.map(0x1000, 4096);
      cpu.write(0x1000, words(0xe2500001, 0x1afffffd, 0xe12fff1e));
      cpu.write(0x1100, Uint8Array.of(0x40, 0x1e, 0xfd, 0xd1, 0x70, 0x47));
      for (const start of [0x1000, 0x1101]) {
        cpu.setReg(0, 1000);
        cpu.setReg(14, 0x1ffc);
        let pc = start;
        for (let slice = 0; slice < 150 && pc !== 0x1ffc; slice++)
          pc = cpu.run(pc, { until: 0x1ffc, count: 32 }).pc;
        expect(pc).toBe(0x1ffc);
        expect(cpu.getReg(0)).toBe(0);
      }
      expect(cpu.compiler?.executions).toBeGreaterThan(0);
      expect(cpu.compiler?.failures).toBe(0);
      if (compilationThreshold > 1) expect(cpu.compiler?.fallbacks).toBeGreaterThan(0);
    } finally {
      cpu.close();
    }
  }
});
