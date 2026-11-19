.syntax unified
.arch armv7-a
.arm
.text
.balign 4
.equ mutex_type, 4
.equ mutex_owner, 8
.equ mutex_depth, 12
.equ mutex_recursive, 2
.equ mutex_signature_low, 0x4d58
.equ mutex_signature_high, 0x5254
@ Ownership tests and the writes they guard stay inside one block (conditional execution, no
@ branches), so block preemption never splits them; LDREX/STREX make them atomic across threads.
.global retrove_mutex_lock
retrove_mutex_lock:
    ldr r1, [r0]
    movw r12, #mutex_signature_low
    movt r12, #mutex_signature_high
    cmp r1, r12
    bne .Llock_host
    mrc p15, 0, r1, c13, c0, 3
    ldr r1, [r1]
    add r3, r0, #mutex_owner
    ldrex r2, [r3]
    cmp r2, #0
    strexeq r12, r1, [r3]
    cmpeq r12, #0
    dmb ish
    moveq r3, #1
    streq r3, [r0, #mutex_depth]
    moveq r0, #0
    bxeq lr
    clrex
    cmp r2, r1
    bne .Llock_host
    ldr r2, [r0, #mutex_type]
    cmp r2, #mutex_recursive
    bne .Llock_host
    ldr r2, [r0, #mutex_depth]
    adds r2, r2, #1
    beq .Llock_host
    str r2, [r0, #mutex_depth]
    mov r0, #0
    bx lr
.Llock_host:
    ldr pc, .Llock_literal
.global retrove_mutex_unlock
retrove_mutex_unlock:
    ldr r1, [r0]
    movw r12, #mutex_signature_low
    movt r12, #mutex_signature_high
    cmp r1, r12
    bne .Lunlock_host
    mrc p15, 0, r1, c13, c0, 3
    ldr r1, [r1]
    ldr r2, [r0, #mutex_owner]
    cmp r2, r1
    bne .Lunlock_host
    ldr r2, [r0, #mutex_depth]
    subs r2, r2, #1
    dmb ish
    str r2, [r0, #mutex_depth]
    moveq r1, #0
    streq r1, [r0, #mutex_owner]
    mov r0, #0
    bx lr
.Lunlock_host:
    ldr pc, .Lunlock_literal
.global retrove_mutex_lock_fallback
retrove_mutex_lock_fallback:
.Llock_literal: .word 0
.global retrove_mutex_unlock_fallback
retrove_mutex_unlock_fallback:
.Lunlock_literal: .word 0
