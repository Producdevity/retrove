import type { FloatPlan } from "../wasm/float-plan";
import { validateFloatPlan } from "../wasm/float-plan";
import { decodeThumb } from "./decode";
import { FloatState } from "./float-state";
import type { FloatRegion, ScratchRegion } from "./float-state";
import type { ThumbInstruction } from "./instruction";
import { Thumb } from "./instruction";
const Limits = { CodeBytes: 65_536, HalfMask: 0xffff, HalfShift: 16 };
export interface FloatProgram {
  readonly address: number;
  readonly code: Uint8Array;
  readonly registers: ReadonlyMap<number, number>;
  readonly pointers: ReadonlyMap<number, number>;
  readonly regions: readonly FloatRegion[];
  readonly scratch: ScratchRegion;
}
function required(value: number | undefined): number {
  if (value === undefined)
    throw new Error("Straight-line kernel reads an unknown integer register or pointer.");
  return value;
}
function integer(
  instruction: ThumbInstruction,
  registers: Map<number, number>,
  pointers: ReadonlyMap<number, number>,
): void {
  const get = (register: number): number => required(registers.get(register));
  switch (instruction.kind) {
    case "move-low":
      registers.set(instruction.destination, instruction.immediate);
      break;
    case "move-high":
      registers.set(
        instruction.destination,
        ((get(instruction.destination) & Limits.HalfMask) |
          (instruction.immediate << Limits.HalfShift)) >>>
          0,
      );
      break;
    case "add-register":
      registers.set(
        instruction.destination,
        (get(instruction.destination) + get(instruction.source)) >>> 0,
      );
      break;
    case "add-immediate":
      registers.set(instruction.destination, (get(instruction.base) + instruction.immediate) >>> 0);
      break;
    case "load-pointers": {
      const base = get(instruction.base);
      instruction.destinations.forEach((destination, index) =>
        registers.set(destination, required(pointers.get(base + index * Thumb.WordBytes))),
      );
      break;
    }
    case "load-pointer":
      registers.set(
        instruction.destination,
        required(pointers.get(get(instruction.base) + instruction.immediate)),
      );
      break;
    default:
      throw new Error("Unexpected integer operation.");
  }
}
function execute(
  instruction: ThumbInstruction,
  registers: Map<number, number>,
  pointers: ReadonlyMap<number, number>,
  state: FloatState,
): void {
  if (instruction.kind === "load-float" || instruction.kind === "store-float") {
    const address = required(registers.get(instruction.base)) + instruction.offset;
    for (let lane = 0; lane < instruction.lanes; lane++) {
      const at = address + lane * Thumb.LaneBytes,
        register = instruction.lane + lane;
      if (instruction.kind === "load-float") state.lanes.set(register, state.load(at));
      else state.store(at, state.lanes.get(register));
    }
  } else if (
    instruction.kind === "add-float" ||
    instruction.kind === "subtract-float" ||
    instruction.kind === "multiply-float" ||
    instruction.kind === "copy-float"
  ) {
    for (let lane = 0; lane < Thumb.Lanes; lane++) {
      const left = state.lanes.get(instruction.left + lane),
        right = state.lanes.get(instruction.right + lane);
      const value =
        instruction.kind === "copy-float"
          ? left
          : state.binary(
              instruction.kind === "add-float"
                ? "add"
                : instruction.kind === "subtract-float"
                  ? "subtract"
                  : "multiply",
              left,
              right,
            );
      state.lanes.set(instruction.destination + lane, value);
    }
  } else integer(instruction, registers, pointers);
}
export function planFloatProgram(program: FloatProgram): FloatPlan {
  if (
    !program.code.byteLength ||
    program.code.byteLength > Limits.CodeBytes ||
    program.code.byteLength % Thumb.HalfBytes ||
    !Number.isSafeInteger(program.address) ||
    program.address < 0 ||
    program.address % Thumb.HalfBytes ||
    program.address + program.code.byteLength > Thumb.AddressLimit
  )
    throw new RangeError("Invalid straight-line Thumb region.");
  const state = new FloatState(program.regions, program.scratch),
    registers = new Map(program.registers);
  const code = new DataView(program.code.buffer, program.code.byteOffset, program.code.byteLength);
  for (let offset = 0; offset < code.byteLength;) {
    registers.set(Thumb.PC, program.address + offset + Thumb.PCBias);
    const decoded = decodeThumb(code, offset);
    execute(decoded.instruction, registers, program.pointers, state);
    offset += decoded.bytes;
  }
  const plan = state.plan();
  validateFloatPlan(plan);
  return plan;
}
