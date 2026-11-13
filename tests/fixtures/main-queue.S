.syntax unified
.arch armv7-a
.arm
.text
.global main
.equ IMAGE, 0x8800
.equ BASE, 0x9000
.equ stage, 128
.equ count, 132
.equ predicate, 136

.macro imported offset
    ldr ip, [r4, #\offset]
    blx ip
.endm

main:
    push {r4, lr}
    movw r4, #BASE
    ldr r0, [r4, #20]          @ NSObject receives the fixture's delegate category
    imported 16                @ NSStringFromClass
    mov r3, r0
    mov r0, #0
    mov r1, #0
    mov r2, #0
    imported 24                @ UIApplicationMain
    mov r0, #1                 @ neither callback exited
    imported 28

.org 0x100                      @ Mach-O initializer
init:
    push {r4, lr}
    movw r4, #BASE
    ldr r0, [r4, #4]           @ &_dispatch_main_q
    adr r1, first_block
    imported 0                 @ dispatch_async
    movw r0, #12000
    imported 12                @ forcibly yield while still in the initializer
    ldr r0, [r4, #count]
    cmp r0, #0
    bne early
    mov r0, #1
    str r0, [r4, #stage]
    pop {r4, pc}

.org 0x200                      @ application:didFinishLaunchingWithOptions:
delegate:
    push {r4, lr}
    movw r4, #BASE
    mov r0, #2
    str r0, [r4, #stage]
    add r0, r4, #predicate
    adr r1, once_block
    imported 8                 @ dispatch_once
    mov r0, #3
    str r0, [r4, #stage]
    mov r0, #1
    pop {r4, pc}

once:
    push {r4, lr}
    movw r4, #BASE
    ldr r0, [r4, #4]
    adr r1, second_block
    imported 0
    movw r0, #12000
    imported 12                @ yield with dispatch_once in flight
    ldr r0, [r4, #count]
    cmp r0, #0
    bne early
    pop {r4, pc}

first:
    movw r4, #BASE
    ldr r0, [r4, #stage]
    cmp r0, #3
    bne early
    ldr r0, [r4, #predicate]
    cmn r0, #1                 @ the once predicate was published
    bne early
    ldr r0, [r4, #count]
    cmp r0, #0
    bne early
    mov r0, #1
    str r0, [r4, #count]
    bx lr

second:
    movw r4, #BASE
    ldr r0, [r4, #count]
    cmp r0, #1
    bne early
    mov r0, #2
    str r0, [r4, #count]
    mov r0, #0
    imported 28
early:
    mov r0, #12
    imported 28

.align 2
.macro global_block label,target
\label: .word 0, (1 << 28), 0, IMAGE+(\target-main), IMAGE+(descriptor-main)
.endm
global_block first_block,first
global_block once_block,once
global_block second_block,second
descriptor: .word 0,20
