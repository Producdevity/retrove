import { HalfBytes, WordBytes } from "./bits";
import type { Decoded, Emitter } from "./emitter";
import { Condition, DataOp, Register, type Instruction, type InstructionOf } from "./instruction";

export interface Discovery {
  readonly leaders: number[];
  readonly reachable: Set<number>;
}

const MaxTableEntries = 1024;
const Hex = 16;
const HalfwordAlign = ~1;
const ByteShift = 8;
const ByteMask = 0xff;
const HalfMask = 0xffff;
const ArmPipeline = 8;
/** ARM jump tables are an `add rX, pc, #imm` followed within three instructions by `ldr pc, [...]`. */
const TableLoadWindow = 4;

/** Halfword from a word reader. */
export const halfReader =
  (readWord: (address: number) => number | undefined) =>
  (address: number): number | undefined => {
    const w = readWord(address & ~(WordBytes - 1));
    return w === undefined
      ? undefined
      : address & HalfBytes
        ? w >>> (ByteShift * HalfBytes)
        : w & HalfMask;
  };

export const isBranchKind = (i: Instruction): boolean =>
  i.kind === "branch" ||
  i.kind === "bx" ||
  (i.kind === "data" && i.rd === Register.PC) ||
  (i.kind === "mem" && i.load && i.rd === Register.PC) ||
  (i.kind === "multiple" && i.load && i.registers.includes(Register.PC));

function instructionAt(e: Emitter, address: number): Decoded {
  const d = e.at.get(address);
  if (!d) throw new Error("No instruction at " + address.toString(Hex));
  return d;
}

/** Targets of a TBB/TBH table at a PC-relative base, read until the first target address. */
function tableTargets(
  e: Emitter,
  i: InstructionOf<"table">,
  root: (address: number) => void,
): void {
  let first = Number.MAX_SAFE_INTEGER;
  const half = halfReader(e.input.readWord),
    bytes = i.half ? HalfBytes : 1,
    table = i.rn === Register.PC ? i.base : -1;
  if (table < 0) return;
  for (let k = 0; k < MaxTableEntries && table + k * bytes < first; k++) {
    const raw = half((table + k * bytes) & HalfwordAlign);
    if (raw === undefined) break;
    const value = i.half ? raw : (table + k) & 1 ? raw >>> ByteShift : raw & ByteMask;
    const target = i.base + HalfBytes * value;
    if (!e.inside(target)) break;
    first = Math.min(first, target);
    root(target);
    e.jumpTargets.add(target);
  }
}

/** Targets of an ARM `add pc`-relative word table consumed by a following `ldr pc`. */
function armTableTargets(
  e: Emitter,
  address: number,
  i: InstructionOf<"data">,
  root: (address: number) => void,
): void {
  if (i.operand.kind !== "imm") return;
  const table = address + ArmPipeline + i.operand.value,
    index = e.decoded.indexOf(instructionAt(e, address));
  const next = e.decoded
    .slice(index + 1, index + TableLoadWindow)
    .find(
      (d) => d.instruction.kind === "mem" && d.instruction.load && d.instruction.rd === Register.PC,
    );
  if (!next) return;
  for (let k = 0; k < MaxTableEntries; k++) {
    const word = e.input.readWord(table + WordBytes * k);
    if (word === undefined || !e.inside(word)) break;
    root(word);
    e.jumpTargets.add(word);
  }
}

/** Whether straight-line decoding stops after `i`: unconditional jumps, returns, tables and unsupported code. */
function endsBlock(i: Instruction): boolean {
  const always = i.cond === Condition.Always || i.cond === Condition.Unconditional;
  const call = (i.kind === "branch" && i.link) || (i.kind === "bx" && i.link);
  return always && ((isBranchKind(i) && !call) || i.kind === "unsupported" || i.kind === "table");
}

/** Recursive descent from the function's entries; literal pools and padding are never reached. */
export function discover(e: Emitter): Discovery {
  const roots = new Set<number>([e.base]);
  for (const entry of [...e.input.entries, e.input.stopPC]) {
    const address = e.local(entry);
    if (address !== undefined) roots.add(address);
  }
  const reachable = new Set<number>(),
    work = [...roots];
  const root = (address: number | undefined) => {
    if (address !== undefined && e.inside(address) && !roots.has(address)) {
      roots.add(address);
      work.push(address);
    }
  };
  while (work.length) {
    for (
      let address = work.pop() ?? 0;
      e.inside(address) && !reachable.has(address);
      address += instructionAt(e, address).size
    ) {
      reachable.add(address);
      const { instruction: i, size } = instructionAt(e, address);
      if (i.kind === "branch") root(i.link ? address + size : e.local(i.target));
      if (i.kind === "bx" && i.link) root(address + size);
      if (i.kind === "cbz") root(e.local(i.target));
      if (i.kind === "table") tableTargets(e, i, root);
      if (!e.thumb && i.kind === "data" && i.op === DataOp.ADD && i.rn === Register.PC)
        armTableTargets(e, address, i, root);
      if (endsBlock(i)) break;
    }
  }
  budgetPoints(e, roots, reachable);
  const leaders = [...roots].filter((a) => reachable.has(a)).sort((a, b) => a - b);
  return { leaders, reachable };
}

/** Backward branch targets and jump-table targets check the budget, as does the function entry. */
function budgetPoints(e: Emitter, roots: Set<number>, reachable: Set<number>): void {
  for (const address of reachable) {
    const i = instructionAt(e, address).instruction;
    const target = i.kind === "branch" && !i.link ? e.local(i.target) : undefined;
    if (target !== undefined && target <= address) e.budgetPoints.add(target);
  }
  for (const address of roots)
    if (address !== e.base && !e.budgetPoints.has(address) && e.jumpTargets.has(address))
      e.budgetPoints.add(address);
  e.budgetPoints.add(e.base);
}
