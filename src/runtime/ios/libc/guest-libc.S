.syntax unified
.cpu cortex-a15
.arm
.text
.equ ASCII_LOWER_FIRST, 97
.equ ASCII_CASE_SPAN, 25
.equ ASCII_CASE_DISTANCE, 32
.equ WORD_BYTES, 4
.equ WORD_SHIFT, 2
.equ SMALL_COPY_LIMIT, 1024
.equ SMALL_FILL_LIMIT, 4096
.equ WORD_ALIGNMENT_MASK, 3
.equ BYTE_MASK, 0xff
.equ BYTE_BITS, 8
.equ HALF_BITS, 16
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
 orr ip, r0, r1
 tst ip, #WORD_ALIGNMENT_MASK
 bne 2f
1:
 cmp r2, #WORD_BYTES
 blo 2f
 ldr ip, [r1], #WORD_BYTES
 str ip, [r3], #WORD_BYTES
 sub r2, r2, #WORD_BYTES
 b 1b
2:
 cmp r2, #0
 bxeq lr
 ldrb ip, [r1], #1
 strb ip, [r3], #1
 sub r2, r2, #1
 b 2b
.global retrove_memcpy_fallback
retrove_memcpy_fallback:
.Lmemcpy_fallback:
 .word 0

.global retrove_umod
retrove_umod:
 cmp r1, #0
 ldreq pc, .Ldivide_fallback
 udiv r2, r0, r1
 mls r0, r2, r1, r0
 bx lr
.global retrove_udiv
retrove_udiv:
 cmp r1, #0
 ldreq pc, .Ldivide_fallback
 udiv r0, r0, r1
 bx lr
.global retrove_mod
retrove_mod:
 cmp r1, #0
 ldreq pc, .Ldivide_fallback
 sdiv r2, r0, r1
 mls r0, r2, r1, r0
 bx lr
.global retrove_div
retrove_div:
 cmp r1, #0
 ldreq pc, .Ldivide_fallback
 sdiv r0, r0, r1
 bx lr
.global retrove_divide_fallback
retrove_divide_fallback:
.Ldivide_fallback:
 .word 0

.global retrove_divmod
retrove_divmod:
 cmp r1, #0
 ldreq pc, .Ldivide_fallback
 sdiv r3, r0, r1
 mls r1, r3, r1, r0
 str r1, [r2]
 mov r0, r3
 bx lr
.global retrove_strcmp
retrove_strcmp:
1:
 ldrb r2, [r0], #1
 ldrb r3, [r1], #1
 subs ip, r2, r3
 movne r0, ip
 bxne lr
 cmp r2, #0
 bne 1b
 mov r0, #0
 bx lr

.global retrove_memset
retrove_memset:
.Lmemset:
 cmp r2, #SMALL_FILL_LIMIT
 ldrhi pc, .Lmemset_fallback
 mov r3, r0
 and r1, r1, #BYTE_MASK
 orr r1, r1, r1, lsl #BYTE_BITS
 orr r1, r1, r1, lsl #HALF_BITS
1:
 cmp r2, #0
 bxeq lr
 tst r3, #WORD_ALIGNMENT_MASK
 beq 2f
 strb r1, [r3], #1
 sub r2, r2, #1
 b 1b
2:
 cmp r2, #WORD_BYTES
 blo 3f
 str r1, [r3], #WORD_BYTES
 sub r2, r2, #WORD_BYTES
 b 2b
3:
 cmp r2, #0
 bxeq lr
 strb r1, [r3], #1
 sub r2, r2, #1
 b 3b
.global retrove_bzero
retrove_bzero:
 mov r2, r1
 mov r1, #0
 b .Lmemset
.global retrove_memset_fallback
retrove_memset_fallback:
.Lmemset_fallback:
 .word 0

.global retrove_memcmp
retrove_memcmp:
1:
 cmp r2, #0
 moveq r0, #0
 bxeq lr
 ldrb r3, [r0], #1
 ldrb ip, [r1], #1
 subs r3, r3, ip
 movne r0, r3
 bxne lr
 sub r2, r2, #1
 b 1b
.global retrove_atomic_add
retrove_atomic_add:
1:
 ldrex r2, [r1]
 add r2, r2, r0
 strex r3, r2, [r1]
 cmp r3, #0
 bne 1b
 mov r0, r2
 bx lr
