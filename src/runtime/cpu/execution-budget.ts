export const ExecutionBudget = { Instructions: "instructions", Blocks: "blocks" } as const;
export type ExecutionBudget = (typeof ExecutionBudget)[keyof typeof ExecutionBudget];
