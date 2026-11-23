import { LoadCommand, readCString, requireFormat, sub, view } from "./format";
import type { ImageTables } from "./image";
import { parseSegment } from "./segment";

const MIN_COMMAND_BYTES = 8;
const COMMAND_ALIGNMENT = 4;
const WORD_BYTES = 4;
const MIN_DYLIB_NAME_OFFSET = 24;
const MIN_MAIN_BYTES = 24;
const UNIX_THREAD_BYTES = 84;
const DYLD_INFO_BYTES = 48;
const MIN_SYMTAB_BYTES = 24;
const MIN_DYSYMTAB_BYTES = 80;
const ARM_THREAD_STATE = 1;
const ARM_THREAD_STATE_WORDS = 17;
const THUMB_STATUS_BIT = 32;
const Field = {
  Second: 8,
  Third: 12,
  CryptId: 16,
  ThreadFlavor: 8,
  ThreadCount: 12,
  ThreadPc: 76,
  ThreadStatus: 80,
} as const;

export interface CommandState {
  entryOffset?: number;
  entryPC?: number;
  dyld?: DataView;
  exportBytes?: Uint8Array;
  sym?: DataView;
  dysym?: DataView;
}

export function readCommands(
  bytes: Uint8Array,
  commands: Uint8Array,
  count: number,
  image: ImageTables,
): CommandState {
  const state: CommandState = {};
  let off = 0;
  for (let i = 0; i < count; i++) {
    const head = view(sub(commands, off, MIN_COMMAND_BYTES, "load command header"));
    const type = head.getUint32(0, true),
      size = head.getUint32(WORD_BYTES, true);
    requireFormat(
      size >= MIN_COMMAND_BYTES && size % COMMAND_ALIGNMENT === 0,
      "invalid load command size",
    );
    const cmd = sub(commands, off, size, "load command");
    off += size;
    applyCommand(bytes, image, state, type, cmd);
  }
  requireFormat(off === commands.length, "load command sizes disagree");
  return state;
}

function applyCommand(
  bytes: Uint8Array,
  image: ImageTables,
  state: CommandState,
  type: number,
  cmd: Uint8Array,
): void {
  const cd = view(cmd),
    size = cmd.length;
  const w = (at: number) => {
    requireFormat(at + WORD_BYTES <= size, "truncated load command");
    return cd.getUint32(at, true);
  };
  switch (type) {
    case LoadCommand.Segment: {
      const seg = parseSegment(cmd, cd);
      sub(bytes, seg.fileOffset, seg.fileSize, `segment ${seg.name}`);
      image.segments.push(seg);
      break;
    }
    case LoadCommand.Dylib:
    case LoadCommand.WeakDylib:
    case LoadCommand.Reexport:
    case LoadCommand.Upward: {
      const at = w(Field.Second);
      requireFormat(at >= MIN_DYLIB_NAME_OFFSET, "invalid dylib name");
      image.dylibs.push(readCString(cmd, at).value);
      break;
    }
    case LoadCommand.Encryption:
      requireFormat(w(Field.CryptId) === 0, "encrypted executable (cryptid is nonzero)");
      break;
    case LoadCommand.Main:
      requireFormat(
        state.entryOffset === undefined && size >= MIN_MAIN_BYTES && w(Field.Third) === 0,
        "invalid main command",
      );
      state.entryOffset = w(Field.Second);
      break;
    case LoadCommand.UnixThread:
      requireFormat(
        state.entryPC === undefined &&
          w(Field.ThreadFlavor) === ARM_THREAD_STATE &&
          w(Field.ThreadCount) === ARM_THREAD_STATE_WORDS &&
          size === UNIX_THREAD_BYTES,
        "unsupported ARM thread state",
      );
      state.entryPC =
        (w(Field.ThreadPc) | (w(Field.ThreadStatus) & THUMB_STATUS_BIT ? 1 : 0)) >>> 0;
      break;
    case LoadCommand.DyldInfo:
    case LoadCommand.DyldInfoOnly:
      requireFormat(!state.dyld && size === DYLD_INFO_BYTES, "invalid dyld info");
      state.dyld = cd;
      break;
    case LoadCommand.ExportsTrie:
      state.exportBytes = sub(bytes, w(Field.Second), w(Field.Third), "export trie");
      break;
    case LoadCommand.ChainedFixups:
      throw new Error("Mach-O: chained fixups are unsupported");
    case LoadCommand.Symtab:
      requireFormat(size >= MIN_SYMTAB_BYTES && !state.sym, "invalid symbol table");
      state.sym = cd;
      break;
    case LoadCommand.Dysymtab:
      requireFormat(size >= MIN_DYSYMTAB_BYTES && !state.dysym, "invalid dynamic symbol table");
      state.dysym = cd;
      break;
    default:
      break;
  }
}
