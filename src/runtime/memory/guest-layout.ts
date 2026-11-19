/**
 * Guest address layout. Only the executable image keeps the address it was linked at; everything
 * else is placed by Retrove inside one 1 GiB span, so the whole guest fits a single flat region of
 * host memory that translated code reaches with one mask and no table lookup.
 */
export const GuestLayout = {
  /** Bytes of guest address space; translated code masks every address into it. */
  Span: 0x4000_0000,
  HeapBase: 0x1000_0000,
  HeapLimit: 0x2800_0000,
  Gates: 0x2800_0000,
  GateBytes: 0x4_0000,
  MappingLow: 0x2810_0000,
  MappingHigh: 0x3fc0_0000,
  StackBottom: 0x3fc0_0000,
  StackTop: 0x4000_0000,
} as const;
/** Mask that keeps an address inside the span; stray pointers wrap instead of escaping it. */
export const GUEST_SPAN_MASK = GuestLayout.Span - 1;
