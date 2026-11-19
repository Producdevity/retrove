import { describe, expect, it } from "vite-plus/test";
import { CodeBudget } from "./code-budget";

describe("translated code budget", () => {
  it("reports when live code passes the limit until released", () => {
    const budget = new CodeBudget(100);
    budget.add(60);
    expect(budget.exceeded).toBe(false);
    budget.add(60);
    expect(budget.exceeded).toBe(true);
    budget.release();
    expect(budget.exceeded).toBe(false);
  });
});
