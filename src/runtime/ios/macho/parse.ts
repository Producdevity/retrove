import { readCommands } from "./commands";
import { exportAddress } from "./exports";
import { fixupStream, type FixupMode } from "./fixups";
import { ARM_CPU_TYPE, requireFormat, sub, view, word } from "./format";
import type { ImageTables, MachOImage } from "./image";
import { selectSlice } from "./slice";
import { executable, isPageZero, Protection, SectionType, type Segment } from "./segment";
import { readIndirect, symbolLookup } from "./symbols";

const THIN_MAGIC = 0xfeedface;
const HEADER_BYTES = 28;
const MH_EXECUTE = 2;
const MIN_HEADER_BYTES = 28;
const COMMAND_HEADER_BYTES = 8;
const WORD_BYTES = 4;
const SUBTYPE_MASK = 0xffffff;
const MAX_INITIALIZERS = 262144;
const MAX_MAPPED_BYTES = 0x20000000;
const THUMB_ALIGNMENT = 2;
const Header = { CpuType: 4, Subtype: 8, FileType: 12, Count: 16, Size: 20, Flags: 24 } as const;
const DyldField = { Rebase: 8, Normal: 16, Weak: 24, Lazy: 32, Export: 40, Length: 4 } as const;
const DYLD_STREAMS: readonly (readonly [FixupMode, number])[] = [
  ["rebase", DyldField.Rebase],
  ["normal", DyldField.Normal],
  ["lazy", DyldField.Lazy],
  ["weak", DyldField.Weak],
];

function layout(image: ImageTables, sorted: readonly Segment[]): Segment {
  const baseSegment = sorted.find(
    (seg) => seg.fileSize >= MIN_HEADER_BYTES && seg.fileOffset === 0,
  );
  requireFormat(baseSegment, "no mapped Mach-O header");
  let end = 0,
    mapped = 0;
  for (const seg of sorted) {
    requireFormat(seg.address >= end, "overlapping guest segments");
    end = seg.address + seg.size;
    if (!isPageZero(seg)) mapped += seg.size;
    for (const s of seg.sections) {
      if (s.type !== SectionType.ModInitFunctions) continue;
      requireFormat(
        s.address % WORD_BYTES === 0 &&
          s.size % WORD_BYTES === 0 &&
          image.initializers.length + s.size / WORD_BYTES <= MAX_INITIALIZERS,
        "invalid initializer table",
      );
      for (let p = 0; p < s.size; p += WORD_BYTES) image.initializers.push(s.address + p);
    }
  }
  requireFormat(mapped <= MAX_MAPPED_BYTES, "image exceeds the 512 MiB mapped image budget");
  return baseSegment;
}

function entryPoint(
  sorted: readonly Segment[],
  entryOffset: number | undefined,
  entryPC: number | undefined,
): Pick<MachOImage, "entry" | "entryKind"> {
  let entry: number | undefined, entryKind: MachOImage["entryKind"];
  if (entryOffset !== undefined) {
    requireFormat(entryPC === undefined, "ambiguous entry point");
    const code = entryOffset - (entryOffset % THUMB_ALIGNMENT);
    const seg = sorted.find(
      (s) =>
        s.protection & Protection.Execute &&
        code >= s.fileOffset &&
        code < s.fileOffset + s.fileSize,
    );
    requireFormat(seg, "entry outside executable segment");
    entry = seg.address + entryOffset - seg.fileOffset;
    entryKind = "main";
  } else {
    entry = entryPC;
    entryKind = "thread";
  }
  requireFormat(entry !== undefined && executable(sorted, entry), "invalid ARM entry point");
  return { entry, entryKind };
}

function applyDyld(
  bytes: Uint8Array,
  dyld: DataView,
  image: ImageTables,
  exportBytes: Uint8Array | undefined,
): Uint8Array {
  const stream = (n: number) =>
    sub(bytes, word(dyld, n), word(dyld, n + DyldField.Length), "dyld stream");
  for (const [mode, at] of DYLD_STREAMS) {
    fixupStream(stream(at), image, mode);
  }
  return exportBytes ?? stream(DyldField.Export);
}

export function parseMachO(input: Uint8Array): MachOImage {
  const bytes = selectSlice(input);
  sub(bytes, 0, HEADER_BYTES, "header");
  const d = view(bytes),
    u = (at: number) => word(d, at);
  requireFormat(
    u(0) === THIN_MAGIC && u(Header.CpuType) === ARM_CPU_TYPE && u(Header.FileType) === MH_EXECUTE,
    "expected 32-bit ARM executable",
  );
  const commands = sub(bytes, HEADER_BYTES, u(Header.Size), "load commands");
  requireFormat(
    u(Header.Count) <= commands.length / COMMAND_HEADER_BYTES,
    "invalid load command count",
  );
  const image: ImageTables = {
    bytes,
    segments: [],
    initializers: [],
    dylibs: [],
    imports: [],
    rebases: [],
    subtype: u(Header.Subtype) & SUBTYPE_MASK,
  };
  const state = readCommands(bytes, commands, u(Header.Count), image);
  const sorted = [...image.segments].sort((a, b) => a.address - b.address);
  const baseSegment = layout(image, sorted);
  const { entry, entryKind } = entryPoint(sorted, state.entryOffset, state.entryPC);
  let exportBytes = state.exportBytes;
  if (state.dyld) exportBytes = applyDyld(bytes, state.dyld, image, exportBytes);
  else readIndirect(image, state.sym, state.dysym, u(Header.Flags));
  return {
    ...image,
    entry,
    entryKind,
    findExport: (name) => exportAddress(exportBytes, baseSegment.address, name),
    symbolAt: symbolLookup(image, state.sym),
  };
}
