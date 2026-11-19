import { callTargets } from "./call-targets";
import type { FunctionRange } from "./translate";

const MachO = {
  Magic: 0xfeedface,
  Execute: 2,
  Segment: 0x1,
  FunctionStarts: 0x26,
  HeaderBytes: 28,
  FileTypeOffset: 12,
  CommandCountOffset: 16,
  CommandSizeOffset: 4,
  NameOffset: 8,
  NameBytes: 16,
  SegmentAddressOffset: 24,
  SegmentFileOffset: 32,
  SectionCountOffset: 48,
  SectionsOffset: 56,
  SectionBytes: 68,
  SectionAddressOffset: 32,
  SectionSizeOffset: 36,
  StubSizeOffset: 64,
  DataOffset: 8,
  DataSizeOffset: 12,
} as const;
const Uleb = { Payload: 0x7f, Continue: 0x80, Bits: 7, Base: 2 } as const;
const MINIMUM_STUB_BYTES = 12;
const Section = { Text: "__text", LinkEdit: "__LINKEDIT" } as const;
/** Import stub sections: PIC stubs, and the non-PIC stubs of iOS 3 era builds (Rayman 2). */
const STUB_SECTIONS = new Set(["__picsymbolstub4", "__symbol_stub4"]);
const THUMB_BIT = 1;

/** Executable code discovered from the Mach-O header and LC_FUNCTION_STARTS in guest memory. */
export interface Executable {
  readonly codeStart: number;
  readonly codeEnd: number;
  readonly ranges: readonly FunctionRange[];
}
export interface ExecutableReader {
  word(address: number): number | undefined;
  read(address: number, length: number): Uint8Array;
}
interface Span {
  start: number;
  end: number;
}
interface Commands {
  text: Span;
  stubs: Span & { size: number };
  linkedit: { address: number; fileOffset: number };
  starts: { offset: number; size: number };
}
const latin1 = new TextDecoder("latin1");
function name(reader: ExecutableReader, address: number): string {
  const text = latin1.decode(reader.read(address, MachO.NameBytes));
  const end = text.indexOf("\0");
  return end < 0 ? text : text.slice(0, end);
}
function segment(reader: ExecutableReader, at: number, commands: Commands): void {
  const word = (address: number): number => reader.word(address) ?? 0;
  if (name(reader, at + MachO.NameOffset) === Section.LinkEdit)
    commands.linkedit = {
      address: word(at + MachO.SegmentAddressOffset),
      fileOffset: word(at + MachO.SegmentFileOffset),
    };
  const sections = word(at + MachO.SectionCountOffset);
  for (let index = 0; index < sections; index++) {
    const section = at + MachO.SectionsOffset + MachO.SectionBytes * index,
      start = word(section + MachO.SectionAddressOffset),
      end = start + word(section + MachO.SectionSizeOffset),
      sectionName = name(reader, section);
    if (sectionName === Section.Text) commands.text = { start, end };
    if (STUB_SECTIONS.has(sectionName))
      commands.stubs = { start, end, size: word(section + MachO.StubSizeOffset) };
  }
}
function loadCommands(reader: ExecutableReader, header: number): Commands {
  const word = (address: number): number => reader.word(address) ?? 0;
  const commands: Commands = {
    text: { start: 0, end: 0 },
    stubs: { start: 0, end: 0, size: 0 },
    linkedit: { address: 0, fileOffset: 0 },
    starts: { offset: 0, size: 0 },
  };
  const count = word(header + MachO.CommandCountOffset);
  for (let index = 0, at = header + MachO.HeaderBytes; index < count; index++) {
    const command = word(at),
      size = word(at + MachO.CommandSizeOffset);
    if (!size) break;
    if (command === MachO.Segment) segment(reader, at, commands);
    if (command === MachO.FunctionStarts)
      commands.starts = {
        offset: word(at + MachO.DataOffset),
        size: word(at + MachO.DataSizeOffset),
      };
    at += size;
  }
  return commands;
}
/** Decodes LC_FUNCTION_STARTS: ULEB128 deltas from the header, ending at a zero delta. */
export function functionStarts(bytes: Uint8Array, header: number, text: Span): number[] {
  const starts: number[] = [];
  let cursor = header,
    index = 0;
  while (index < bytes.length) {
    let value = 0,
      scale = 1,
      byte = 0;
    do {
      byte = bytes[index++] ?? 0;
      value += (byte & Uleb.Payload) * scale;
      scale *= Uleb.Base ** Uleb.Bits;
    } while (byte & Uleb.Continue);
    if (!value) break;
    cursor += value;
    if (cursor >= text.start && cursor < text.end) starts.push(cursor);
  }
  return starts;
}
/** One start per address; call scans can find the same address in both instruction sets. */
function distinctStarts(starts: readonly number[]): number[] {
  return starts.filter(
    (start, index) =>
      index === 0 || ((starts[index - 1] ?? 0) & ~THUMB_BIT) !== (start & ~THUMB_BIT),
  );
}
function executableAt(reader: ExecutableReader, header: number): Executable | undefined {
  if (
    reader.word(header) !== MachO.Magic ||
    reader.word(header + MachO.FileTypeOffset) !== MachO.Execute
  )
    return undefined;
  const { text, stubs, linkedit, starts } = loadCommands(reader, header);
  if (!text.end) return undefined;
  const list =
    starts.size && linkedit.address
      ? functionStarts(
          reader.read(linkedit.address + starts.offset - linkedit.fileOffset, starts.size),
          header,
          text,
        )
      : distinctStarts(callTargets(reader.read(text.start, text.end - text.start), text.start));
  if (!list.length) return undefined;
  const ranges: FunctionRange[] = list.map((start, index) => ({
    start,
    end: (list[index + 1] ?? text.end) & ~THUMB_BIT,
  }));
  if (stubs.size >= MINIMUM_STUB_BYTES && stubs.start >= text.end)
    for (let stub = stubs.start; stub + stubs.size <= stubs.end; stub += stubs.size)
      ranges.push({ start: stub, end: stub + stubs.size });
  return { codeStart: text.start, codeEnd: Math.max(text.end, stubs.end), ranges };
}
/** Returns the first mapped region that starts with an MH_EXECUTE header and lists its functions. */
export function discoverExecutable(
  regions: Iterable<number>,
  reader: ExecutableReader,
): Executable | undefined {
  for (const region of regions) {
    const executable = executableAt(reader, region);
    if (executable) return executable;
  }
  return undefined;
}
/** The function containing `pc`, matching its ARM/Thumb state; undefined outside known functions. */
export function functionAt(
  executable: Executable | undefined,
  pc: number,
): FunctionRange | undefined {
  const address = pc & ~THUMB_BIT;
  if (!executable || address < executable.codeStart || address >= executable.codeEnd)
    return undefined;
  const ranges = executable.ranges;
  let low = 0,
    high = ranges.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (((ranges[middle]?.start ?? 0) & ~THUMB_BIT) <= address) low = middle;
    else high = middle - 1;
  }
  const range = ranges[low];
  if (
    !range ||
    (range.start & ~THUMB_BIT) > address ||
    address >= range.end ||
    (range.start & THUMB_BIT) !== (pc & THUMB_BIT)
  )
    return undefined;
  return range;
}
