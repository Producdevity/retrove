.syntax unified
.arm
.text
.equ ASCII_LOWER_FIRST, 97
.equ ASCII_CASE_SPAN, 25
.equ ASCII_CASE_DISTANCE, 32
.equ WORD_BYTES, 4
.equ WORD_SHIFT, 2
.equ SMALL_COPY_LIMIT, 64
.global retrove_toupper
retrove_toupper:
 sub r1, r0, #ASCII_LOWER_FIRST
 cmp r1, #ASCII_CASE_SPAN
 subls r0, r0, #ASCII_CASE_DISTANCE
 bx lr
.global retrove_wcslen
retrove_wcslen:
 mov r1, r0
1:
 ldr r2, [r1], #WORD_BYTES
 cmp r2, #0
 bne 1b
 sub r0, r1, r0
 sub r0, r0, #WORD_BYTES
 lsr r0, r0, #WORD_SHIFT
 bx lr
.global retrove_wcscpy
retrove_wcscpy:
 mov r2, r0
1:
 ldr r3, [r1], #WORD_BYTES
 str r3, [r2], #WORD_BYTES
 cmp r3, #0
 bne 1b
 bx lr
.global retrove_wcscmp
retrove_wcscmp:
1:
 ldr r2, [r0], #WORD_BYTES
 ldr r3, [r1], #WORD_BYTES
 cmp r2, r3
 bne 2f
 cmp r2, #0
 bne 1b
 mov r0, #0
 bx lr
2:
 movgt r0, #1
 mvnlt r0, #0
 bx lr
.global retrove_memcpy
retrove_memcpy:
 cmp r2, #SMALL_COPY_LIMIT
 ldrhi pc, .Lmemcpy_fallback
 cmp r2, #0
 bxeq lr
 mov r3, r0
1:
 ldrb ip, [r1], #1
 strb ip, [r3], #1
 subs r2, r2, #1
 bne 1b
 bx lr
.global retrove_memcpy_fallback
retrove_memcpy_fallback:
.Lmemcpy_fallback:
 .word 0
