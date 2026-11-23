import { fixedString, MAX_ADDRESS, PAGE_SIZE, requireFormat, word } from "./format";

export interface Section {
  name: string;
  address: number;
  size: number;
  fileOffset: number;
  type: number;
  reserved1: number;
  reserved2: number;
}
export interface Segment {
  name: string;
  address: number;
  size: number;
  fileOffset: number;
  fileSize: number;
  maxProtection: number;
  protection: number;
  sections: Section[];
}

export const SectionType = {
  ZeroFill: 0x1,
  GlobalOffsetTable: 0x6,
  LazyPointers: 0x7,
  ModInitFunctions: 0x9,
  GbZeroFill: 0xc,
  ThreadLocalZeroFill: 0x12,
} as const;
export const Protection = { Execute: 4 } as const;
const SEGMENT_COMMAND_BYTES = 56;
const SECTION_BYTES = 68;
const NAME_BYTES = 16;
const SEGMENT_NAME_AT = 8;
const SEGMENT_FIELD = {
  Address: 24,
  Size: 28,
  FileOffset: 32,
  FileSize: 36,
  MaxProtection: 40,
  Protection: 44,
  SectionCount: 48,
  Flags: 52,
} as const;
const SECTION_FIELD = {
  SegmentName: 16,
  Address: 32,
  Size: 36,
  FileOffset: 40,
  Alignment: 44,
  Relocations: 52,
  Flags: 56,
  Reserved1: 60,
  Reserved2: 64,
} as const;
const SECTION_TYPE_MASK = 0xff;
const MAX_PROTECTION = 7;
const MAX_ALIGNMENT = 31;
const ALIGNMENT_BASE = 2;
const PAGE_ZERO = "__PAGEZERO";
const ADDRESS_SPACE = MAX_ADDRESS + 1;
const THUMB_BIT = 2;
const THUMB_WIDTH = 2;
const ARM_WIDTH = 4;

function parseSection(cmd: Uint8Array, d: DataView, at: number, segment: Segment): Section {
  const u = (offset: number) => word(d, at + offset);
  const section: Section = {
    name: fixedString(cmd.subarray(at, at + NAME_BYTES)),
    address: u(SECTION_FIELD.Address),
    size: u(SECTION_FIELD.Size),
    fileOffset: u(SECTION_FIELD.FileOffset),
    type: u(SECTION_FIELD.Flags) & SECTION_TYPE_MASK,
    reserved1: u(SECTION_FIELD.Reserved1),
    reserved2: u(SECTION_FIELD.Reserved2),
  };
  const { name, address, size, fileSize, fileOffset } = segment;
  const relative = section.address - address;
  requireFormat(
    fixedString(
      cmd.subarray(at + SECTION_FIELD.SegmentName, at + SECTION_FIELD.SegmentName + NAME_BYTES),
    ) === name &&
      relative >= 0 &&
      relative + section.size <= size &&
      u(SECTION_FIELD.Alignment) <= MAX_ALIGNMENT &&
      section.address % ALIGNMENT_BASE ** u(SECTION_FIELD.Alignment) === 0,
    `invalid section ${section.name}`,
  );
  requireFormat(
    u(SECTION_FIELD.Relocations) === 0,
    `section relocations unsupported in ${section.name}`,
  );
  const zeroFill: number[] = [
    SectionType.ZeroFill,
    SectionType.GbZeroFill,
    SectionType.ThreadLocalZeroFill,
  ];
  if (!zeroFill.includes(section.type)) {
    requireFormat(
      section.fileOffset === fileOffset + relative && relative + section.size <= fileSize,
      `invalid file range for ${section.name}`,
    );
  }
  return section;
}

export function parseSegment(cmd: Uint8Array, d: DataView): Segment {
  requireFormat(cmd.length >= SEGMENT_COMMAND_BYTES, "truncated segment");
  const u = (at: number) => word(d, at);
  const segment: Segment = {
    name: fixedString(cmd.subarray(SEGMENT_NAME_AT, SEGMENT_NAME_AT + NAME_BYTES)),
    address: u(SEGMENT_FIELD.Address),
    size: u(SEGMENT_FIELD.Size),
    fileOffset: u(SEGMENT_FIELD.FileOffset),
    fileSize: u(SEGMENT_FIELD.FileSize),
    maxProtection: u(SEGMENT_FIELD.MaxProtection),
    protection: u(SEGMENT_FIELD.Protection),
    sections: [],
  };
  const { name, address, size, fileSize, protection, maxProtection } = segment;
  const sectionCount = u(SEGMENT_FIELD.SectionCount);
  requireFormat(
    SEGMENT_COMMAND_BYTES + sectionCount * SECTION_BYTES === cmd.length,
    "invalid section count",
  );
  requireFormat(
    address % PAGE_SIZE === 0 &&
      size % PAGE_SIZE === 0 &&
      address + size <= ADDRESS_SPACE &&
      size > 0 &&
      fileSize <= size &&
      maxProtection <= MAX_PROTECTION &&
      !(protection & ~maxProtection) &&
      u(SEGMENT_FIELD.Flags) === 0,
    `invalid segment ${name}`,
  );
  if (name === PAGE_ZERO) {
    requireFormat(
      address === 0 && fileSize === 0 && maxProtection === 0 && !sectionCount,
      "invalid __PAGEZERO",
    );
  } else requireFormat(address >= PAGE_SIZE, `null page mapped by ${name}`);
  for (let i = 0; i < sectionCount; i++) {
    segment.sections.push(parseSection(cmd, d, SEGMENT_COMMAND_BYTES + i * SECTION_BYTES, segment));
  }
  return segment;
}

export function isPageZero(segment: { name: string }): boolean {
  return segment.name === PAGE_ZERO;
}

export function executable(
  segments: readonly Pick<Segment, "protection" | "address" | "fileSize">[],
  target: number,
): boolean {
  const thumb = target % THUMB_BIT;
  const pc = target - thumb;
  const width = thumb ? THUMB_WIDTH : ARM_WIDTH;
  return (
    Number.isInteger(target) &&
    pc % width === 0 &&
    segments.some(
      (s) =>
        s.protection & Protection.Execute &&
        pc >= s.address &&
        pc + width <= s.address + s.fileSize,
    )
  );
}
