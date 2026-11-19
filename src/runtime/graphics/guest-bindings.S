.syntax unified
.cpu cortex-a15
.arm
.text
@ Shadow words, written by the host after each binding it applies; UNKNOWN never matches a name.
.equ SHADOW_ACTIVE_TEXTURE, 8
.equ SHADOW_TEXTURES, 12
.equ BUFFER_TARGET_HIGH, 0x8800
.equ BUFFER_TARGET_LOW, 0x92
.equ BUFFER_TARGET_LAST, 1
.equ TEXTURE_UNIT_HIGH, 0x8400
.equ TEXTURE_UNIT_LOW, 0xc0
.equ TEXTURE_UNIT_LAST, 15
.equ TEXTURE_2D, 0x0de1
.equ WORD_SHIFT, 2

@ glBindBuffer(target, buffer): returns when the target already holds the buffer.
.global retrove_bind_buffer
retrove_bind_buffer:
 sub r2, r0, #BUFFER_TARGET_HIGH
 sub r2, r2, #BUFFER_TARGET_LOW
 cmp r2, #BUFFER_TARGET_LAST
 ldrhi pc, .Lbind_buffer_host
 ldr r12, .Lshadow
 ldr r3, [r12, r2, lsl #WORD_SHIFT]
 cmp r3, r1
 bxeq lr
 ldr pc, .Lbind_buffer_host

@ glActiveTexture(texture): returns when the unit is already active.
.global retrove_active_texture
retrove_active_texture:
 ldr r12, .Lshadow
 ldr r3, [r12, #SHADOW_ACTIVE_TEXTURE]
 cmp r3, r0
 bxeq lr
 ldr pc, .Lactive_texture_host

@ glBindTexture(target, texture): returns when the active unit already holds the 2D texture.
.global retrove_bind_texture
retrove_bind_texture:
 movw r2, #TEXTURE_2D
 cmp r0, r2
 ldrne pc, .Lbind_texture_host
 ldr r12, .Lshadow
 ldr r3, [r12, #SHADOW_ACTIVE_TEXTURE]
 sub r3, r3, #TEXTURE_UNIT_HIGH
 sub r3, r3, #TEXTURE_UNIT_LOW
 cmp r3, #TEXTURE_UNIT_LAST
 ldrhi pc, .Lbind_texture_host
 add r12, r12, r3, lsl #WORD_SHIFT
 ldr r3, [r12, #SHADOW_TEXTURES]
 cmp r3, r1
 bxeq lr
 ldr pc, .Lbind_texture_host

.global retrove_bindings_shadow
retrove_bindings_shadow:
.Lshadow:
 .word 0
.global retrove_bind_buffer_host
retrove_bind_buffer_host:
.Lbind_buffer_host:
 .word 0
.global retrove_active_texture_host
retrove_active_texture_host:
.Lactive_texture_host:
 .word 0
.global retrove_bind_texture_host
retrove_bind_texture_host:
.Lbind_texture_host:
 .word 0
