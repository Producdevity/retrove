.syntax unified
.cpu cortex-a15
.arm
.text
@ Hooked entries start with push {r4-r7,lr}; add r7,sp,#12. Misses replay both and resume past them.
.equ LIGHT_DATA, 0x3c4
.equ RENDER_DATA, 0x3c0
.equ REVISION, 0x3cc
.equ SECOND_REVISION, 0x3d0
.equ LIGHT_REVISION, 4
.equ DATA_REVISION, 0x74
.equ DATA_SECOND_REVISION, 0x78
.equ FRAME_POINTER_OFFSET, 12
.equ NAME_SLOT, 248
.equ NAME_TEXT_LOW, 0x5a0c
.equ NAME_TEXT_HIGH, 0x1a7
.equ FNAME_ADD, 1
.equ NAME_NUMBER, 1

@ AActor::GetLightRenderData: returns actor+0x3c4 while its revision matches actor+0x3cc.
.global retrove_light_render_data
retrove_light_render_data:
 ldr r1, [r0, #LIGHT_DATA]
 cmp r1, #0
 beq 1f
 ldr r2, [r1, #LIGHT_REVISION]
 ldr r3, [r0, #REVISION]
 cmp r2, r3
 moveq r0, r1
 bxeq lr
1:
 push {r4, r5, r6, r7, lr}
 add r7, sp, #FRAME_POINTER_OFFSET
 ldr pc, .Llight_resume

@ AActor::RefreshActorRenderData: returns 0 while actor+0x3c0 matches both actor revisions.
.global retrove_refresh_render_data
retrove_refresh_render_data:
 ldr r1, [r0, #RENDER_DATA]
 cmp r1, #0
 beq 1f
 ldr r2, [r1, #DATA_REVISION]
 ldr r3, [r0, #REVISION]
 cmp r2, r3
 bne 1f
 ldr r2, [r1, #DATA_SECOND_REVISION]
 ldr r3, [r0, #SECOND_REVISION]
 cmp r2, r3
 moveq r0, #0
 bxeq lr
1:
 push {r4, r5, r6, r7, lr}
 add r7, sp, #FRAME_POINTER_OFFSET
 ldr pc, .Lrefresh_resume

@ SetTextureUnit's FName(L"PhotoRenderTarget", FNAME_Add, 1) at sp+248: built once, then copied.
@ r0-r3, r12 and lr are free at the hooked site.
.global retrove_photo_target_name
retrove_photo_target_name:
 add r0, sp, #NAME_SLOT
 ldr r12, .Lname_cache
 ldrd r2, r3, [r12]
 cmp r2, #0
 beq 1f
 strd r2, r3, [r0]
 ldr pc, .Lname_resume
1:
 movw r1, #NAME_TEXT_LOW
 movt r1, #NAME_TEXT_HIGH
 mov r2, #FNAME_ADD
 mov r3, #NAME_NUMBER
 ldr r12, .Lname_construct
 blx r12
 add r0, sp, #NAME_SLOT
 ldrd r2, r3, [r0]
 ldr r12, .Lname_cache
 strd r2, r3, [r12]
 ldr pc, .Lname_resume

.Llight_resume:
 .word 0xb0d000
.Lrefresh_resume:
 .word 0x5e0be4
.Lname_construct:
 .word 0x58bae0
.Lname_resume:
 .word 0x183b0b4
.global retrove_photo_target_cache
retrove_photo_target_cache:
.Lname_cache:
 .word 0
