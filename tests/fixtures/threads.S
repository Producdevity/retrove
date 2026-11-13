.syntax unified
.arch armv7-a
.arm
.text
.global main
main:
    push {r4-r6, lr}
    movw r4, #0x9000
    add r0, r4, #32
    mov r1, #0
    adr r2, worker
    mov r3, #37
    ldr r12, [r4]
    blx r12                      @ pthread_create(&thread, NULL, worker, 37)
    cmp r0, #0
    bne failed
    ldr r0, [r4, #32]
    add r1, r4, #36
    ldr r12, [r4, #4]
    blx r12                      @ pthread_join(thread, &result)
    cmp r0, #0
    bne failed
    ldr r0, [r4, #36]
    sub r0, r0, #42
    pop {r4-r6, pc}
failed:
    mov r0, #99
    pop {r4-r6, pc}
worker:
    push {r4, lr}
    mov r4, r0
    mov r0, #500
    movw r1, #0x9000
    ldr r12, [r1, #8]
    blx r12                      @ usleep(500) exercises suspension
    add r0, r4, #5
    pop {r4, pc}
.org 0x100
    bx lr                        @ Mach-O initializer
