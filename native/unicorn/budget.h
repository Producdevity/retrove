/* SPDX-License-Identifier: GPL-2.0-or-later */
#define RETROVE_MIN_INSTRUCTION_BYTES 2u
typedef struct {
    uc_engine *engine;
    uc_hook hook;
    int64_t remaining;
} RetroveBudget;

static void retrove_budget_enter(uc_engine *engine, uint64_t address, uint32_t size, void *opaque)
{
    RetroveBudget *budget = opaque;
    if (budget->remaining <= 0) { uc_emu_stop(engine); return; }
    uint32_t cost = (size + RETROVE_MIN_INSTRUCTION_BYTES - 1) / RETROVE_MIN_INSTRUCTION_BYTES;
    budget->remaining -= cost ? cost : 1;
}
EMSCRIPTEN_KEEPALIVE uintptr_t retrove_budget_create(uc_engine *engine)
{
    RetroveBudget *budget = calloc(1, sizeof(*budget));
    if (!budget) return 0;
    budget->engine = engine;
    if (uc_hook_add(engine, &budget->hook, UC_HOOK_BLOCK, retrove_budget_enter, budget, 1, 0) != UC_ERR_OK) {
        free(budget);
        return 0;
    }
    return (uintptr_t)budget;
}
EMSCRIPTEN_KEEPALIVE void retrove_budget_start(RetroveBudget *budget, uint32_t count)
{
    budget->remaining = count;
}
EMSCRIPTEN_KEEPALIVE void retrove_budget_close(RetroveBudget *budget)
{
    uc_hook_del(budget->engine, budget->hook);
    free(budget);
}
