.syntax unified
.arm
.text
.global _main
_main:
    push    {r4-r8, lr}
    sub     sp, sp, #24
    movw    r4, #0x9000         @ __DATA: import slots, constructor pointer, marker
    ldr     r0, [r4, #24]
    cmp     r0, #0x5a
    movne   r0, #1
    bne     done

    adr     r0, filename
    mov     r1, #0
    ldr     ip, [r4]            @ _open
    blx     ip
    cmp     r0, #0
    movmi   r0, #2
    bmi     done
    mov     r5, r0
    mov     r1, sp
    mov     r2, #20
    ldr     ip, [r4, #4]        @ _read
    blx     ip
    mov     r6, r0
    mov     r0, r5
    ldr     ip, [r4, #8]        @ _close
    blx     ip
    cmp     r6, #20
    movne   r0, #3
    bne     done
    cmp     r0, #0
    movne   r0, #4
    bne     done

    ldmia   sp, {r0-r3}         @ four little-endian IEEE 754 color components
    eor     r6, r0, r1
    eor     r6, r6, r2
    eor     r6, r6, r3
    ldr     r7, [sp, #16]
    cmp     r6, r7
    movne   r0, #5
    bne     done
    ldr     ip, [r4, #12]       @ _glClearColor, iOS ARMv7 base AAPCS
    blx     ip
    mov     r0, #0x4000         @ GL_COLOR_BUFFER_BIT
    ldr     ip, [r4, #16]       @ _glClear
    blx     ip
    mov     r0, #0
done:
    add     sp, sp, #24
    pop     {r4-r8, pc}

filename:
    .asciz "rgba.bin"

.org 0x100
constructor:
    movw    r0, #0x9000
    mov     r1, #0x5a
    str     r1, [r0, #24]
    bx      lr
