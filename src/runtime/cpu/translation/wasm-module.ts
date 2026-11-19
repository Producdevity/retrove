import { Bytes } from "./wasm-bytes";
import type { Code } from "./wasm-code";
import type { ValueType } from "./wasm-opcodes";

const Preamble = { Magic: 0x6d736100, Version: 1 } as const;
const Section = {
  Type: 1,
  Import: 2,
  Function: 3,
  Table: 4,
  Export: 7,
  Element: 9,
  Code: 10,
} as const;
const ExternalKind = { Function: 0, Table: 1, Memory: 2, Global: 3 } as const;
const I32 = 0x7f;
const Immutable = 0x00;
const FunctionReference = 0x70;
const FunctionForm = 0x60;
const Limits = { NoMaximum: 0x00, SharedWithMaximum: 0x03 } as const;
/** wasm32 memories hold at most 4 GiB of 64 KiB pages. */
const MAX_MEMORY_PAGES = 0x1_0000;

export interface FunctionType {
  readonly params: readonly ValueType[];
  readonly results: readonly ValueType[];
}

export interface ModuleFunction {
  readonly type: number;
  readonly code: Code;
  readonly exportName?: string;
}

/**
 * Version of the import list and of how emitted code addresses the state block. Cached modules
 * from another version are translated again, never instantiated.
 */
export const ModuleFormat = 3;

/**
 * Module importing `env.memory`, `env.table` and the immutable i32s `env.arena`, `env.labels` and
 * `env.state`. A shared memory import must be declared shared with a maximum, and only matches a
 * shared memory, so modules are emitted for one kind of memory.
 */
export function module(options: {
  readonly types: readonly FunctionType[];
  readonly functions: readonly ModuleFunction[];
  readonly shared?: boolean | undefined;
}): Uint8Array<ArrayBuffer> {
  const out = new Bytes().word(Preamble.Magic).word(Preamble.Version);
  const section = (id: number, content: Bytes) => out.byte(id).sized(content);
  const types = options.types.map((type) =>
    new Bytes()
      .byte(FunctionForm)
      .unsigned(type.params.length)
      .byte(...type.params)
      .unsigned(type.results.length)
      .byte(...type.results),
  );
  section(Section.Type, new Bytes().vector(types));
  const memory = new Bytes().name("env").name("memory").byte(ExternalKind.Memory);
  if (options.shared) memory.byte(Limits.SharedWithMaximum).unsigned(0).unsigned(MAX_MEMORY_PAGES);
  else memory.byte(Limits.NoMaximum).unsigned(0);
  const table = new Bytes()
    .name("env")
    .name("table")
    .byte(ExternalKind.Table, FunctionReference, Limits.NoMaximum);
  const arena = new Bytes().name("env").name("arena").byte(ExternalKind.Global, I32, Immutable);
  const labels = new Bytes().name("env").name("labels").byte(ExternalKind.Global, I32, Immutable);
  const state = new Bytes().name("env").name("state").byte(ExternalKind.Global, I32, Immutable);
  section(Section.Import, new Bytes().vector([memory, table.unsigned(0), arena, labels, state]));
  const declarations = options.functions.map((entry) => new Bytes().unsigned(entry.type));
  section(Section.Function, new Bytes().vector(declarations));
  const exports = options.functions.flatMap((entry, index) =>
    entry.exportName
      ? [new Bytes().name(entry.exportName).byte(ExternalKind.Function).unsigned(index)]
      : [],
  );
  section(Section.Export, new Bytes().vector(exports));
  section(Section.Code, new Bytes().vector(options.functions.map((entry) => entry.code.encode())));
  return out.values.slice();
}
