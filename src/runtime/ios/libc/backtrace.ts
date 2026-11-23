import type { GuestArguments } from "../objc/host";
import { read32, write32, type GuestMemory, type Heap } from "../../memory/guest-memory";

const StackPointer = 13;
const LinkRegister = 14;
/** Darwin's ARMv7 frame pointer. Each record holds the previous r7 and the saved lr. */
const FramePointer = 7;
const EXECUTABLE = 4;
const THUMB_BIT = 2;
const FRAME_ALIGNMENT_MASK = 3;
const WORD_BYTES = 4;
const FRAME_RECORD_BYTES = 8;
const MAX_STACK_BYTES = 0x200_0000;
const ENOMEM = 12;
const HEX_DIGITS = 8;
const HEX = 16;
const Argument = { First: 0, Second: 1 } as const;
const encoder = new TextEncoder();

export interface BacktraceCpu extends GuestMemory {
  getReg(index: number): number;
}
export interface BacktraceImage {
  readonly segments: readonly {
    readonly protection: number;
    readonly address: number;
    readonly size: number;
  }[];
  symbolAt(address: number): { readonly name: string; readonly offset: number } | undefined;
}

export function guestStack(
  cpu: BacktraceCpu | null | undefined,
  limit: number,
  image?: Pick<BacktraceImage, "segments">,
): number[] {
  if (!cpu || limit <= 0) return [];
  const stack = cpu.getReg(StackPointer),
    frames: number[] = [];
  let frame = cpu.getReg(FramePointer),
    address = cpu.getReg(LinkRegister);
  for (let i = 0; i < limit && address; i++) {
    const pc = address - (address % THUMB_BIT);
    if (
      image &&
      !image.segments.some(
        (segment) =>
          segment.protection & EXECUTABLE &&
          pc >= segment.address &&
          pc < segment.address + segment.size,
      )
    )
      break;
    frames.push(address);
    if (!frame || frame & FRAME_ALIGNMENT_MASK || frame < stack || frame - stack >= MAX_STACK_BYTES)
      break;
    let next: number;
    try {
      next = read32(cpu, frame);
      address = read32(cpu, frame + WORD_BYTES);
    } catch {
      break; // A partially written frame can still describe its caller.
    }
    if (next && next < frame + FRAME_RECORD_BYTES) break;
    frame = next;
  }
  return frames;
}

export function backtraceImports(
  cpu: BacktraceCpu,
  heap: Pick<Heap, "alloc">,
  errno: number,
  image?: BacktraceImage,
  executable = "guest",
): Record<"_backtrace" | "_backtrace_symbols", (a: GuestArguments) => number> {
  const symbolLine = (index: number, address: number): Uint8Array => {
    const symbol = image?.symbolAt(address);
    const hex = `0x${address.toString(HEX).padStart(HEX_DIGITS, "0")}`;
    const name = symbol ? executable : "???";
    const where = symbol ? `${symbol.name} + ${symbol.offset}` : hex;
    return encoder.encode(`${index}   ${name}   ${hex} ${where}\0`);
  };
  return {
    _backtrace: (a) => {
      const out = a(Argument.First),
        limit = a(Argument.Second) | 0;
      if (!out || limit <= 0) return 0;
      const frames = guestStack(cpu, limit, image);
      frames.forEach((pointer, i) => write32(cpu, out + WORD_BYTES * i, pointer));
      return frames.length;
    },
    _backtrace_symbols: (a) => {
      const addr = a(Argument.First),
        count = a(Argument.Second) | 0;
      if (!addr || count <= 0) return 0;
      const lines: Uint8Array[] = [];
      let length = WORD_BYTES * count;
      for (let i = 0; i < count; i++) {
        const line = symbolLine(i, read32(cpu, addr + i * WORD_BYTES));
        lines.push(line);
        length += line.length;
      }
      const out = heap.alloc(length);
      if (!out) {
        write32(cpu, errno, ENOMEM);
        return 0;
      }
      let text = out + WORD_BYTES * count;
      lines.forEach((line, i) => {
        write32(cpu, out + WORD_BYTES * i, text);
        cpu.write(text, line);
        text += line.length;
      });
      return out;
    },
  };
}
