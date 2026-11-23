import { GuestLandingPad } from "../../cxx/landing-pad";
import { guestStack } from "../libc/backtrace";
import type { MachOImage } from "../macho/macho";
import type { SymbolMatch } from "../macho/image";
import { registerValue } from "../threads/thread-types";
import type { RunState } from "./run-state";
import { guestSnapshot, hex, label, type GuestSnapshot } from "./snapshot";

const MESSAGE_LENGTH = 1024;
const DEFERRED_PAGE = 4096;
const STACK_FRAMES = 24;
const EXECUTE = 4;
const BYTES_BEFORE_PC = 8;
const BYTES_AFTER_PC = 16;
const HEX = 16;
const HEX_BYTE_WIDTH = 2;
const INSTRUCTION_ALIGNMENT = 2;
const CODE_REGISTERS = ["pc", "lr"] as const;

/** The guest called exit(); the runtime unwinds to its exit handlers. */
export class GuestExit extends Error {
  constructor(readonly status: number) {
    super("guest exit");
  }
}
interface ImageCode {
  readonly segment: string;
  readonly section: string | undefined;
  readonly symbol: SymbolMatch | undefined;
  readonly start: string;
  readonly bytes: string;
}
export interface Fault {
  readonly name: string;
  readonly message: string;
  address?: string;
  access?: unknown;
  size?: unknown;
  symbol?: string;
  guestStack?: { readonly address: string; readonly symbol: SymbolMatch | undefined }[];
  imageCode?: Record<string, ImageCode>;
}
export type FaultReport = GuestSnapshot & { readonly fault: Fault };

/** A property of a thrown value, read as `error?.[name]` would. */
function property(error: unknown, name: string): unknown {
  if ((typeof error !== "object" && typeof error !== "function") || error === null)
    return undefined;
  const value: unknown = Reflect.get(error, name);
  return value;
}
const aligned = (address: number): number => address - (address % INSTRUCTION_ALIGNMENT);

/** Short instruction windows around pc and lr that fall in executable segments of the original slice. */
function imageCode(
  image: MachOImage,
  registers: Readonly<Record<string, string>>,
): Record<string, ImageCode> {
  const code: Record<string, ImageCode> = {};
  for (const register of CODE_REGISTERS) {
    const pc = aligned(Number(registers[register]));
    const segment = image.segments.find(
      (s) => s.protection & EXECUTE && pc >= s.address && pc < s.address + s.fileSize,
    );
    if (!segment) continue;
    const section = segment.sections.find((s) => pc >= s.address && pc < s.address + s.size);
    const start = Math.max(section?.address ?? segment.address, pc - BYTES_BEFORE_PC);
    const end = Math.min(
      section ? section.address + section.size : segment.address + segment.fileSize,
      pc + BYTES_AFTER_PC,
    );
    const offset = segment.fileOffset + start - segment.address;
    const bytes = Array.from(image.bytes.subarray(offset, offset + end - start), (v) =>
      v.toString(HEX).padStart(HEX_BYTE_WIDTH, "0"),
    ).join(" ");
    code[register] = {
      segment: segment.name,
      section: section?.name,
      symbol: image.symbolAt(pc),
      start: hex(start),
      bytes,
    };
  }
  return code;
}

function describe(state: RunState, error: unknown): Fault {
  const fault: Fault = {
    name: label(property(error, "name") || "Error"),
    message: String(property(error, "message") || error).slice(0, MESSAGE_LENGTH),
  };
  const faultAddress = property(error, "faultAddress");
  if (faultAddress !== undefined) {
    const address = registerValue(faultAddress);
    fault.address = hex(address);
    fault.access = property(error, "faultAccess");
    fault.size = property(error, "faultSize");
    for (const [name, base] of state.deferred) {
      if (address >= base && address < base + DEFERRED_PAGE) {
        fault.symbol = label(name);
        break;
      }
    }
  }
  return fault;
}

/** Records the first fault with the CPU state at that moment; later faults keep it. */
export function captureFault(
  state: RunState,
  error: unknown,
  report: (snapshot: unknown) => void,
): void {
  if (state.firstFault || error instanceof GuestExit || error instanceof GuestLandingPad) return;
  const fault = describe(state, error);
  const snapshot = guestSnapshot(state, true);
  const { cpu, image } = state.parts;
  if (cpu && image)
    try {
      fault.guestStack = guestStack(cpu, STACK_FRAMES, image).map((address) => ({
        address: hex(address),
        symbol: image.symbolAt(aligned(address)),
      }));
    } catch {
      /* Preserve the primary fault when the CPU can no longer be inspected. */
    }
  // Use the original Mach-O slice. It remains readable even after a Wasm trap.
  if (image) {
    const code = imageCode(image, snapshot.registers);
    if (Object.keys(code).length) fault.imageCode = code;
  }
  state.firstFault = { fault, ...snapshot };
  report(state.firstFault);
}
