import { expect, test } from "vite-plus/test";
import { createCPU } from "../cpu";
import { TciTierLimit } from "../tci/tier";
import { ExecutionBudget } from "../execution-budget";

test("sporadic blocks do not displace the repeatedly executed working set", async () => {
  const cpu = await createCPU({ budget: ExecutionBudget.Blocks });
  const base = 0x1000,
    stride = 16,
    hot = 64,
    cold = 6144,
    stop = 0x40000;
  const hotPasses = 256,
    rounds = 80,
    measuredRounds = 8,
    driver = 0x30000;
  try {
    cpu.map(base, 0x40000);
    const code = new Uint32Array(((hot + cold) * stride) / 4);
    for (let block = 0; block < hot + cold; block++) {
      code[block * 4] = 0xe2800001;
      code[block * 4 + 1] = 0xe12fff1e;
    }
    cpu.write(base, new Uint8Array(code.buffer));
    cpu.setReg(0, 0);
    cpu.write(
      driver,
      new Uint8Array(
        Uint32Array.of(
          0xe1a08004,
          0xe12fff38,
          0xe2888010,
          0xe1580005,
          0x3afffffb,
          0xe2566001,
          0x1afffff8,
          0xe1a08005,
          0xe12fff38,
          0xe2888010,
          0xe1580007,
          0x3afffffb,
          0xe12fff19,
        ).buffer,
      ),
    );
    cpu.setReg(4, base);
    cpu.setReg(5, base + hot * stride);
    cpu.setReg(7, base + (hot + cold) * stride);
    cpu.setReg(9, stop);
    const round = () => {
      cpu.setReg(6, hotPasses);
      expect(cpu.run(driver, { until: stop, count: 2_000_000 }).reason).toBe("until");
    };
    for (let repeat = 0; repeat < rounds; repeat++) round();
    const warm = cpu.compiler;
    for (let repeat = 0; repeat < measuredRounds; repeat++) round();
    const settled = cpu.compiler;
    if (!warm || !settled) throw new Error("Compiler statistics missing.");
    expect(settled.attempts).toBeLessThanOrEqual(hot * 2);
    expect(settled.attempts - warm.attempts).toBeLessThanOrEqual(hot);
    expect(settled.executions - warm.executions).toBeGreaterThanOrEqual(
      hot * hotPasses * measuredRounds * 0.99,
    );
    expect(settled.functions).toBeLessThanOrEqual(TciTierLimit.Functions);
    expect(settled.bytes).toBeLessThanOrEqual(TciTierLimit.Bytes);
    expect(cpu.getReg(0)).toBe((hot * hotPasses + cold) * (rounds + measuredRounds));
    expect(settled.failures).toBe(0);
  } finally {
    cpu.close();
  }
}, 120000);
