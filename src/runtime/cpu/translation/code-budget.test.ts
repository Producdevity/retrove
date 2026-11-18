import { describe, expect, it } from "vite-plus/test";
import { CodeBudget } from "./code-budget";

describe("translated code budget", () => {
  it("reports when live code passes the limit and frees label tables on release", () => {
    const freed: number[] = [];
    const budget = new CodeBudget((pointer) => freed.push(pointer), 100);
    budget.labels.push(16, 32);
    budget.add(60);
    expect(budget.exceeded).toBe(false);
    budget.add(60);
    expect(budget.exceeded).toBe(true);
    budget.release();
    expect([budget.exceeded, freed, budget.labels]).toEqual([false, [16, 32], []]);
  });
});
