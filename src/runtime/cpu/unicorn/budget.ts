interface BudgetModule {
  _retrove_budget_create(engine: number): number;
  _retrove_budget_start(budget: number, instructions: number): void;
  _retrove_budget_close(budget: number): void;
}
export class UnicornBudget {
  readonly #module: BudgetModule;
  readonly #handle: number;
  #started = false;
  #trapsChanged = false;
  #stopAddress = 0;
  #closed = false;
  constructor(module: BudgetModule, engine: number) {
    this.#module = module;
    this.#handle = module._retrove_budget_create(engine);
    if (!this.#handle) throw new Error("Unable to allocate the CPU execution budget.");
  }
  invalidateTraps(): void {
    this.#trapsChanged = this.#started;
  }
  requiresRefresh(until: number): boolean {
    return this.#started && (this.#trapsChanged || until !== this.#stopAddress);
  }
  stop(): void {
    this.#requireOpen();
    this.#module._retrove_budget_start(this.#handle, 0);
  }
  start(instructions: number, until: number): void {
    this.#requireOpen();
    this.#module._retrove_budget_start(this.#handle, instructions);
    this.#started = true;
    this.#trapsChanged = false;
    this.#stopAddress = until;
  }
  #requireOpen(): void {
    if (this.#closed) throw new Error("CPU execution budget is closed.");
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#module._retrove_budget_close(this.#handle);
  }
}
