.syntax unified
.cpu cortex-a15
.fpu vfpv3-d16
.arm
.text
.macro binary_single name, instruction
.global retrove_\name
retrove_\name:
 vmov s14, r0
 vmov s15, r1
 \instruction\().f32 s14, s14, s15
 vmov r0, s14
 bx lr
.endm
.macro binary_double name, instruction
.global retrove_\name
retrove_\name:
 vmov d6, r0, r1
 vmov d7, r2, r3
 \instruction\().f64 d6, d6, d7
 vmov r0, r1, d6
 bx lr
.endm
binary_single addsf3vfp, vadd
binary_single subsf3vfp, vsub
binary_single mulsf3vfp, vmul
binary_single divsf3vfp, vdiv
binary_double adddf3vfp, vadd
binary_double subdf3vfp, vsub
binary_double muldf3vfp, vmul
binary_double divdf3vfp, vdiv
.macro compare_single name, condition
.global retrove_\name
retrove_\name:
 vmov s14, r0
 vmov s15, r1
 vcmp.f32 s14, s15
 vmrs APSR_nzcv, fpscr
 mov r0, #0
 mov\condition r0, #1
 bx lr
.endm
.macro compare_double name, condition
.global retrove_\name
retrove_\name:
 vmov d6, r0, r1
 vmov d7, r2, r3
 vcmp.f64 d6, d7
 vmrs APSR_nzcv, fpscr
 mov r0, #0
 mov\condition r0, #1
 bx lr
.endm
compare_single eqsf2vfp, eq
compare_single nesf2vfp, ne
compare_single gesf2vfp, ge
compare_single gtsf2vfp, gt
compare_single lesf2vfp, ls
compare_single ltsf2vfp, lo
compare_single unordsf2vfp, vs
compare_double eqdf2vfp, eq
compare_double nedf2vfp, ne
compare_double gedf2vfp, ge
compare_double gtdf2vfp, gt
compare_double ledf2vfp, ls
compare_double ltdf2vfp, lo
compare_double unorddf2vfp, vs
.macro convert_single name, operation
.global retrove_\name
retrove_\name:
 vmov s14, r0
 vcvt.\operation s14, s14
 vmov r0, s14
 bx lr
.endm
convert_single floatsisfvfp, f32.s32
convert_single floatunssisfvfp, f32.u32
convert_single fixsfsivfp, s32.f32
.macro integer_double name, operation
.global retrove_\name
retrove_\name:
 vmov s14, r0
 vcvt.\operation d7, s14
 vmov r0, r1, d7
 bx lr
.endm
integer_double floatsidfvfp, f64.s32
integer_double floatunssidfvfp, f64.u32
integer_double extendsfdf2vfp, f64.f32
.macro double_integer name, operation
.global retrove_\name
retrove_\name:
 vmov d7, r0, r1
 vcvt.\operation s14, d7
 vmov r0, s14
 bx lr
.endm
double_integer fixdfsivfp, s32.f64
double_integer fixunsdfsivfp, u32.f64
double_integer truncdfsf2vfp, f32.f64
