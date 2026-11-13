.syntax unified
.arch armv7-a
.arm
.text
.global main
main:
    push {r4-r6, lr}
    movw r4, #0x9000             @ import slots
    add r5, r4, #64              @ pthread mutex
    mov r0, r5
    mov r1, #0
    ldr r12, [r4, #8]
    blx r12                      @ pthread_mutex_init
    mov r0, r5
    ldr r12, [r4, #12]
    blx r12                      @ main owns the mutex
    add r0, r4, #128
    mov r1, #0
    adr r2, worker
    mov r3, #0
    ldr r12, [r4]
    blx r12                      @ pthread_create
wait_for_worker:
    mov r0, #1000
    ldr r12, [r4, #24]
    blx r12                      @ usleep, allowing the worker to start dispatch_once
    ldr r0, [r4, #140]
    cmp r0, #1
    bne wait_for_worker
    mov r0, r5
    ldr r12, [r4, #16]
    blx r12                      @ let the owner of dispatch_once acquire the lock
    adr lr, 1f
    b once
1:
    ldr r0, [r4, #128]
    mov r1, #0
    ldr r12, [r4, #4]
    blx r12                      @ pthread_join
    ldr r0, [r4, #144]
    sub r0, r0, #1               @ one and only one invocation
    pop {r4-r6, pc}

worker:
    push {r4, lr}
    movw r4, #0x9000
    adr lr, 1f
    b once
1:
    mov r0, #0
    pop {r4, pc}
once:
    add r0, r4, #132
    add r1, r4, #160
    adr r2, locked_block
    str r2, [r1, #12]
    ldr r12, [r4, #20]
    bx r12                       @ tail call dispatch_once(&token, &block)
locked_block:
    push {r4, lr}
    movw r4, #0x9000
    mov r1, #1
    str r1, [r4, #140]
    add r0, r4, #64
    ldr r12, [r4, #12]
    blx r12                      @ waits for main to return from scheduler and unlock
    ldr r1, [r4, #144]
    add r1, #1
    str r1, [r4, #144]
    add r0, r4, #64
    ldr r12, [r4, #16]
    blx r12
    pop {r4, pc}
.org 0x100
    bx lr                        @ Mach-O initializer
