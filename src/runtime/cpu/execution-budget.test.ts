import { expect, test } from "vite-plus/test";
import { createCPU } from "./cpu";
import { ExecutionBudget } from "./execution-budget";
const words = (...values: number[]) => new Uint8Array(Uint32Array.from(values).buffer);
test("block budgets preempt ARM and Thumb loops and retain completed instructions", async () => {
  const cpu = await createCPU({ budget: ExecutionBudget.Blocks });
  try {
    cpu.map(0x1000, 4096);
    cpu.write(0x1000, words(0xe2500001, 0x1afffffd, 0xe12fff1e));
    cpu.write(0x1100, Uint8Array.of(0x40, 0x1e, 0xfd, 0xd1, 0x70, 0x47));
    cpu.write(0x1200, words(0xeafffffe));
    for (const start of [0x1000, 0x1101]) {
      cpu.setReg(0, 1000);
      cpu.setReg(14, 0x1ffc);
      let pc = start,
        slices = 0;
      for (; slices < 1000; slices++) {
        const result = cpu.run(pc, { until: 0x1ffc, count: 32 });
        if (result.reason === "until") break;
        expect(result.reason).toBe("budget");
        pc = result.pc;
      }
      expect(slices).toBeGreaterThan(1);
      expect(slices).toBeLessThan(1000);
      expect(cpu.getReg(0)).toBe(0);
      expect(cpu.getReg(15)).toBe(0x1ffc);
    }
    expect(cpu.run(0x1200, { count: 64 })).toMatchObject({ reason: "budget", pc: 0x1200 });
    let lateTrap = false;
    cpu.trap(0x1200, () => {
      lateTrap = true;
    });
    expect(cpu.run(0x1200, { count: 64 })).toMatchObject({ reason: "trap", pc: 0x1200 });
    expect(lateTrap).toBe(true);
  } finally {
    cpu.close();
  }
});
test("block budgets keep ARM import traps and return to Thumb", async () => {
  const cpu = await createCPU({ budget: ExecutionBudget.Blocks });
  try {
    cpu.map(0x1000, 8192);
    cpu.write(0x1000, Uint8Array.of(0x40, 0xf2, 0x28, 0, 0x98, 0x47, 1, 0x30, 0, 0xbf));
    cpu.write(0x2000, words(0xeafffffe));
    let trapped = 0;
    cpu.trap(0x2000, () => {
      trapped++;
    });
    for (let iteration = 0; iteration < 100; iteration++) {
      cpu.setReg(3, 0x2000);
      expect(cpu.run(0x1001, { count: 32 })).toMatchObject({ reason: "trap", pc: 0x2000 });
      expect(cpu.getReg(0)).toBe(40);
      expect(cpu.getReg(14)).toBe(0x1007);
      cpu.setReg(0, 41);
      expect(cpu.run(cpu.getReg(14), { until: 0x1008 })).toMatchObject({ reason: "until" });
      expect(cpu.getReg(0)).toBe(42);
    }
    expect(trapped).toBe(100);
  } finally {
    cpu.close();
  }
});
test("unrolled writes survive translated block boundaries", async () => {
  const cpu = await createCPU({ budget: ExecutionBudget.Blocks });
  try {
    cpu.map(0x1000, 4096, 5);
    cpu.map(0x8000, 4096, 3);
    const code: number[] = [];
    for (let index = 0; index < 300; index++) code.push(0xe2800003, 0xe4810004);
    const bytes = words(...code),
      end = 0x1000 + bytes.length;
    cpu.write(0x1000, bytes);
    cpu.setReg(0, 0);
    cpu.setReg(1, 0x8000);
    let pc = 0x1000;
    for (let slice = 0; slice < 1000 && pc !== end; slice++)
      pc = cpu.run(pc, { until: end, count: 97 }).pc;
    expect(pc).toBe(end);
    const table = cpu.read(0x8000, 1200),
      view = new DataView(table.buffer);
    for (let index = 0; index < 300; index++)
      expect(view.getUint32(index * 4, true)).toBe((index + 1) * 3);
  } finally {
    cpu.close();
  }
});

test("late traps inside cached ARM and Thumb blocks execute each preceding instruction once", async () => {
  const cpu = await createCPU({ budget: ExecutionBudget.Blocks });
  try {
    cpu.map(0x1000, 4096);
    cpu.write(0x1000, words(0xe2800001, 0xe2800002, 0xeafffffc));
    cpu.write(0x1100, Uint8Array.of(1, 0x30, 2, 0x30, 0xfc, 0xe7));
    for (const [start = 0, trap = 0] of [
      [0x1000, 0x1004],
      [0x1101, 0x1102],
    ]) {
      expect(cpu.run(start, { count: 32 }).reason).toBe("budget");
      let calls = 0;
      const remove = cpu.trap(trap, () => {
        calls++;
      });
      cpu.setReg(0, 42);
      expect(cpu.run(start, { count: 32 })).toMatchObject({ reason: "trap" });
      expect(cpu.getReg(0)).toBe(43);
      expect(calls).toBe(1);
      remove();
      cpu.setReg(0, 42);
      expect(cpu.run(start, { count: 32 }).reason).toBe("budget");
      expect(cpu.getReg(0)).toBeGreaterThan(45);
      expect(calls).toBe(1);
    }
  } finally {
    cpu.close();
  }
});
test("changed stop addresses invalidate cached block exits", async () => {
  const cpu = await createCPU({ budget: ExecutionBudget.Blocks });
  try {
    cpu.map(0x1000, 4096);
    cpu.write(0x1000, words(0xe2800001, 0xe2800002, 0xeafffffc));
    cpu.setReg(0, 0);
    expect(cpu.run(0x1000, { until: 0x1008, count: 32 }).reason).toBe("until");
    expect(cpu.getReg(0)).toBe(3);
    cpu.setReg(0, 0);
    expect(cpu.run(0x1000, { until: 0x1004, count: 32 }).reason).toBe("until");
    expect(cpu.getReg(0)).toBe(1);
  } finally {
    cpu.close();
  }
});

test("block slices preserve VFP state across cooperative thread switches and memory faults", async () => {
  const cpu = await createCPU({ budget: ExecutionBudget.Blocks });
  try {
    cpu.map(0x1000, 4096, 5);
    cpu.map(0x8000, 4096, 3);
    cpu.write(0x1000, words(0xee000a10, 0xe12fff1e));
    cpu.write(0x1100, words(0xee101a10, 0xe5821000, 0xe12fff1e));
    cpu.setReg(0, 0x3fc00000);
    cpu.setReg(14, 0x1ffc);
    expect(cpu.run(0x1000, { until: 0x1ffc }).reason).toBe("until");
    const state = cpu.saveState();
    cpu.setReg(0, 0x40400000);
    cpu.run(0x1000, { until: 0x1ffc });
    cpu.setReg(2, 0x8000);
    cpu.run(0x1100, { until: 0x1ffc });
    expect(cpu.getReg(1)).toBe(0x40400000);
    cpu.restoreState(state);
    cpu.freeState(state);
    cpu.setReg(2, 0x8000);
    cpu.run(0x1100, { until: 0x1ffc });
    expect(cpu.getReg(1)).toBe(0x3fc00000);
    expect(cpu.read(0x8000, 4)).toEqual(words(0x3fc00000));
    cpu.protect(0x8000, 4096, 1);
    expect(() => cpu.run(0x1100, { until: 0x1ffc })).toThrow(/UC_ERR_WRITE_PROT/);
  } finally {
    cpu.close();
  }
});
