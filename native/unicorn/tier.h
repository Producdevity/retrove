/* SPDX-License-Identifier: GPL-2.0-or-later */
#include <emscripten.h>
#include "exec/exec-all.h"

#define RETROVE_TIER_BITS 12
#define RETROVE_TIER_WAYS 4
#define RETROVE_TIER_SLOTS (1u << RETROVE_TIER_BITS)
#define RETROVE_TIER_HASH 0x9e3779b1u
#define RETROVE_TIER_MAX_BYTES 65536u

typedef uint32_t (*RetroveBlock)(uint32_t *, uint8_t **, uintptr_t *);
typedef struct {
    uintptr_t address;
    uint32_t size;
    uint32_t hits;
    RetroveBlock compiled;
    uint32_t used;
} RetroveEntry;

static RetroveEntry retrove_entries[RETROVE_TIER_SLOTS * RETROVE_TIER_WAYS];
static uint32_t retrove_clock;
static uint32_t retrove_enabled;
static uint32_t retrove_threshold = 64;
static uint32_t retrove_metrics[6];

EM_JS(int, retrove_compile, (int address, int size), {
    return Module['retroveTier'] ? Module['retroveTier'].compile(address >>> 0, size) : 0;
});
EM_JS(void, retrove_release, (int index), {
    if (Module['retroveTier']) Module['retroveTier'].release(index);
});
EM_JS(void, retrove_clear, (), {
    if (Module['retroveTier']) Module['retroveTier'].clear();
});

static RetroveEntry *retrove_entry(uintptr_t address)
{
    uint32_t index = ((address >> 2) * RETROVE_TIER_HASH) >> (32 - RETROVE_TIER_BITS);
    RetroveEntry *group = &retrove_entries[index * RETROVE_TIER_WAYS];
    for (uint32_t way = 0; way < RETROVE_TIER_WAYS; way++)
        if (group[way].address == address) return &group[way];
    for (uint32_t way = 0; way < RETROVE_TIER_WAYS; way++)
        if (!group[way].address) return &group[way];
    RetroveEntry *cold = NULL;
    uint32_t heat = UINT32_MAX;
    for (uint32_t way = 0; way < RETROVE_TIER_WAYS; way++) {
        uint32_t hits = group[way].hits == UINT32_MAX ? 0 : group[way].hits;
        if (!group[way].compiled && (!cold || hits < heat)) {
            cold = &group[way];
            heat = hits;
        }
    }
    if (cold) return cold;
    for (uint32_t way = 0; way < RETROVE_TIER_WAYS; way++) {
        if (!group[way].used) return &group[way];
        group[way].used = 0;
    }
    return group;
}

static void retrove_discard(RetroveEntry *entry)
{
    if (!entry->compiled) return;
    retrove_release((int)(uintptr_t)entry->compiled);
    entry->compiled = NULL;
    entry->hits = 0;
    retrove_metrics[5]++;
}

static RetroveEntry *retrove_record(uintptr_t address, uint32_t size)
{
    RetroveEntry *entry = retrove_entry(address);
    retrove_discard(entry);
    *entry = (RetroveEntry){address, size, 0, NULL, 0};
    return entry;
}

void retrove_tci_register(void *code, uint32_t size)
{
    if (!retrove_enabled || !size || size > RETROVE_TIER_MAX_BYTES) return;
    retrove_record((uintptr_t)code, size);
    retrove_metrics[0]++;
}

EMSCRIPTEN_KEEPALIVE int retrove_tci_evict(void)
{
    const uint32_t entries = ARRAY_SIZE(retrove_entries);
    for (uint32_t scanned = 0; scanned < entries * 2; scanned++) {
        RetroveEntry *entry = &retrove_entries[retrove_clock++ % entries];
        if (!entry->compiled) continue;
        if (entry->used) { entry->used = 0; continue; }
        retrove_discard(entry);
        return 1;
    }
    return 0;
}

void retrove_tci_reset(void)
{
    memset(retrove_entries, 0, sizeof(retrove_entries));
    retrove_clock = 0;
    retrove_clear();
}

EMSCRIPTEN_KEEPALIVE void retrove_tci_configure(uint32_t threshold)
{
    retrove_tci_reset();
    memset(retrove_metrics, 0, sizeof(retrove_metrics));
    retrove_enabled = threshold != 0;
    retrove_threshold = threshold;
}

EMSCRIPTEN_KEEPALIVE uintptr_t retrove_tci_statistics(void)
{
    return (uintptr_t)retrove_metrics;
}

static int retrove_dispatch(CPUArchState *env, uint32_t *regs, uint8_t **next, uintptr_t *result)
{
    RetroveEntry *entry;
    if (!retrove_enabled) return -1;
    entry = retrove_entry((uintptr_t)*next);
    if (entry->address != (uintptr_t)*next) {
        TranslationBlock *tb = tcg_tb_lookup(env->uc->tcg_ctx, (uintptr_t)*next);
        if (!tb || tb->tc.ptr != *next || !tb->tc.size || tb->tc.size > RETROVE_TIER_MAX_BYTES) {
            retrove_metrics[3]++;
            return -1;
        }
        entry = retrove_record((uintptr_t)*next, tb->tc.size);
        retrove_metrics[4]++;
    }
    entry->used = 1;
    if (!entry->compiled && entry->hits != UINT32_MAX && ++entry->hits >= retrove_threshold) {
        entry->hits = UINT32_MAX;
        retrove_metrics[1]++;
        entry->compiled = (RetroveBlock)(uintptr_t)retrove_compile(entry->address, entry->size);
    }
    if (!entry->compiled) { retrove_metrics[3]++; return -1; }
    retrove_metrics[2]++;
    return entry->compiled(regs, next, result);
}

typedef struct { const char *name; uint32_t value; } RetroveConstant;
static const RetroveConstant retrove_constants[] = {
#define DEF(name, ...) {#name, INDEX_op_ ## name},
#include "tcg/tcg-opc.h"
#undef DEF
#define RETROVE_COND(name) {"condition_" #name, TCG_COND_ ## name}
    RETROVE_COND(EQ), RETROVE_COND(NE), RETROVE_COND(LT), RETROVE_COND(GE),
    RETROVE_COND(LE), RETROVE_COND(GT), RETROVE_COND(LTU), RETROVE_COND(GEU),
    RETROVE_COND(LEU), RETROVE_COND(GTU),
#undef RETROVE_COND
    {"register_count", TCG_TARGET_NB_REGS}, {"environment_register", TCG_AREG0},
    {"stack_register", TCG_REG_CALL_STACK}, {"constant_operand", TCG_CONST},
};
EMSCRIPTEN_KEEPALIVE uintptr_t retrove_tci_constants(void) { return (uintptr_t)retrove_constants; }
EMSCRIPTEN_KEEPALIVE uint32_t retrove_tci_constant_count(void) { return ARRAY_SIZE(retrove_constants); }
EMSCRIPTEN_KEEPALIVE uintptr_t retrove_tci_pc(void) { return (uintptr_t)&tci_tb_ptr; }

EMSCRIPTEN_KEEPALIVE uint64_t retrove_tci_load(CPUArchState *env, target_ulong taddr,
                                               TCGMemOpIdx oi, uintptr_t next)
{
    uint8_t *tb_ptr = (uint8_t *)next;
    switch (get_memop(oi) & (MO_BSWAP | MO_SSIZE)) {
    case MO_UB: return qemu_ld_ub;
    case MO_SB: return (int64_t)(int8_t)qemu_ld_ub;
    case MO_LEUW: return qemu_ld_leuw;
    case MO_LESW: return (int64_t)(int16_t)qemu_ld_leuw;
    case MO_LEUL: return qemu_ld_leul;
    case MO_LESL: return (int64_t)(int32_t)qemu_ld_leul;
    case MO_LEQ: return qemu_ld_leq;
    case MO_BEUW: return qemu_ld_beuw;
    case MO_BESW: return (int64_t)(int16_t)qemu_ld_beuw;
    case MO_BEUL: return qemu_ld_beul;
    case MO_BESL: return (int64_t)(int32_t)qemu_ld_beul;
    case MO_BEQ: return qemu_ld_beq;
    default: tcg_abort();
    }
}
EMSCRIPTEN_KEEPALIVE void retrove_tci_store(CPUArchState *env, target_ulong taddr,
                                            uint64_t value, TCGMemOpIdx oi, uintptr_t next)
{
    uint8_t *tb_ptr = (uint8_t *)next;
    switch (get_memop(oi) & (MO_BSWAP | MO_SIZE)) {
    case MO_UB: qemu_st_b(value); return;
    case MO_LEUW: qemu_st_lew(value); return;
    case MO_LEUL: qemu_st_lel(value); return;
    case MO_LEQ: qemu_st_leq(value); return;
    case MO_BEUW: qemu_st_bew(value); return;
    case MO_BEUL: qemu_st_bel(value); return;
    case MO_BEQ: qemu_st_beq(value); return;
    default: tcg_abort();
    }
}
EMSCRIPTEN_KEEPALIVE uintptr_t retrove_tci_load_entry(void) { return (uintptr_t)&retrove_tci_load; }
EMSCRIPTEN_KEEPALIVE uintptr_t retrove_tci_store_entry(void) { return (uintptr_t)&retrove_tci_store; }
EMSCRIPTEN_KEEPALIVE int retrove_tci_invalidate(uc_engine *engine, uint32_t address, uint32_t size)
{
    if (!size) return UC_ERR_OK;
    return uc_ctl_remove_cache(engine, (uint64_t)address, (uint64_t)address + size);
}
