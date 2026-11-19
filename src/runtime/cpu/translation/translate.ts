import { WordBytes } from "./bits";
import { decode } from "./decode-arm";
import { discover, halfReader } from "./discover";
import { emitDispatch } from "./dispatch";
import { FirstTranslated, FunctionType, ReloadType, SpillType } from "./emit-constants";
import { emitReload, emitSpill, stateTypes } from "./state-helpers";
import { emitFunction, type EmittedFunction } from "./emit-function";
import { Emitter, type Decoded } from "./emitter";
import { Condition, unsupported } from "./instruction";
import { decodeThumbRange } from "./thumb-range";
import type {
  FunctionRange,
  TranslatedFunction,
  Translation,
  TranslationInput,
} from "./translation-types";
import { module, type ModuleFunction } from "./wasm-module";
import { Type } from "./wasm-opcodes";

export { ForeignProbes } from "./emit-constants";
export type {
  FunctionRange,
  TranslatedFunction,
  Translation,
  TranslationInput,
  TranslationStatistics,
} from "./translation-types";

/** Rounds of root discovery for Thumb code; each round may reset IT state at newly found branch targets. */
const RootRounds = 6;
/** Retranslations that move exits out of IT blocks. */
const ItRounds = 4;
const ThumbBit = 1;
const Hex = 16;
const NoFunction = (): undefined => undefined;

/** Marks the IT instructions at `starts` unsupported so execution leaves before the block begins. */
function withItExits(decoded: readonly Decoded[], starts: ReadonlySet<number>): readonly Decoded[] {
  if (!starts.size) return decoded;
  return decoded.map((d) =>
    starts.has(d.address) ? { ...d, instruction: unsupported(Condition.Always) } : d,
  );
}

function decodeArm(range: FunctionRange, input: TranslationInput): Decoded[] {
  const decoded: Decoded[] = [];
  for (let address = range.start; address < range.end; address += WordBytes) {
    const word = input.readWord(address);
    const instruction = word === undefined ? unsupported(Condition.Always) : decode(word, address);
    decoded.push({ address, size: WordBytes, instruction });
  }
  return decoded;
}

/** Thumb decoding restarts IT state at every control-flow root, which depends on the decoding itself. */
function decodeThumb(range: FunctionRange, input: TranslationInput): readonly Decoded[] {
  const roots = new Set<number>();
  const half = halfReader(input.readWord);
  let decoded: readonly Decoded[] = [];
  for (let round = 0; round < RootRounds; round++) {
    decoded = decodeThumbRange(range.start & ~ThumbBit, range.end, half, roots);
    const found = discover(new Emitter(range, decoded, 0, input, NoFunction)).leaders;
    const before = roots.size;
    for (const address of found) roots.add(address);
    if (roots.size === before) break;
  }
  const blocked = decoded.filter(
    (d) => d.instruction.kind === "unsupported" && d.itStart !== undefined,
  );
  return withItExits(decoded, new Set(blocked.map((d) => d.itStart ?? 0)));
}

function translateFunction(
  range: FunctionRange,
  input: TranslationInput,
  functionIndex: (address: number) => number | undefined,
): { decoded: readonly Decoded[]; labelAddress: number; result: EmittedFunction } {
  let decoded = range.start & ThumbBit ? decodeThumb(range, input) : decodeArm(range, input);
  const labelAddress = input.labelAddress(range);
  let emitter = new Emitter(range, decoded, labelAddress, input, functionIndex);
  let result = emitFunction(emitter);
  // An exit inside an IT block cannot carry ITSTATE to the interpreter: such blocks leave at their IT instruction.
  for (let round = 0; emitter.itExits.size && round < ItRounds; round++) {
    decoded = withItExits(decoded, emitter.itExits);
    emitter = new Emitter(range, decoded, labelAddress, input, functionIndex);
    result = emitFunction(emitter);
  }
  return { decoded, labelAddress, result };
}

/** Translates guest functions into one Wasm module whose function 0 dispatches by guest PC. */
export function translate(input: TranslationInput): Translation {
  const functions = [...input.functions].sort((a, b) => a.start - b.start);
  const indexOf = new Map(functions.map((f, i) => [f.start, i]));
  const functionIndex = (address: number) => {
    const index = indexOf.get(address);
    return index === undefined ? undefined : FirstTranslated + index;
  };
  const bodies: ModuleFunction[] = [
    { type: FunctionType, code: emitDispatch(input.layout) },
    { type: SpillType, code: emitSpill(input.layout) },
    { type: ReloadType, code: emitReload(input.layout) },
  ];
  const translated: TranslatedFunction[] = [];
  const unsupportedExecutable: number[] = [];
  let instructions = 0,
    reachable = 0,
    blocks = 0,
    unsupportedCount = 0;
  for (const range of functions) {
    const { decoded, labelAddress, result } = translateFunction(range, input, functionIndex);
    const exportName = "f" + range.start.toString(Hex);
    bodies.push({ type: FunctionType, code: result.code, exportName });
    translated.push({ ...range, exportName, labelAddress, labels: result.labels });
    instructions += decoded.length;
    reachable += result.reachable;
    blocks += result.blocks;
    unsupportedCount += result.unsupported;
    unsupportedExecutable.push(...result.unsupportedLeaders);
  }
  const types = [
    { params: [Type.I32], results: [Type.I32] },
    { params: stateTypes(), results: [] },
    { params: [], results: stateTypes() },
  ];
  const wasm = module({ types, functions: bodies, shared: input.shared });
  return {
    wasm,
    functions: translated,
    statistics: {
      functions: functions.length,
      instructions,
      reachable,
      blocks,
      unsupported: unsupportedCount,
      unsupportedExecutable,
    },
  };
}
