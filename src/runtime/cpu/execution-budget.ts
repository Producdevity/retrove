export const ExecutionBudget = { Instructions: "instructions", Blocks: "blocks" } as const;
export type ExecutionBudget = (typeof ExecutionBudget)[keyof typeof ExecutionBudget];
const MIN_INSTRUCTION_BYTES = 2;
export class BlockBudget {
  private remaining = 0;
  private started = false;
  private trapsChanged = false;
  private stopAddress = 0;
  invalidateTraps(): void {
    this.trapsChanged = this.started;
  }
  requiresRefresh(until: number): boolean {
    return this.started && (this.trapsChanged || until !== this.stopAddress);
  }
  stop(): void {
    this.remaining = 0;
  }
  start(instructions: number, until: number): void {
    this.remaining = instructions;
    this.started = true;
    this.trapsChanged = false;
    this.stopAddress = until;
  }
  enter(bytes: number): boolean {
    if (this.remaining <= 0) return false;
    // Thumb instructions can be two bytes; stop at the next translated block boundary.
    this.remaining -= Math.max(1, Math.ceil(bytes / MIN_INSTRUCTION_BYTES));
    return true;
  }
}
