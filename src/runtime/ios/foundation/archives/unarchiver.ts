import { Argument, type FoundationHost } from "../../objc/host";
import { floatBits } from "../../abi/scalars";
import { archiveKey, ArchiveGraph, type ArchiveFields } from "./graph";

const CODER = "NSCoder";
const UNARCHIVER = "NSKeyedUnarchiver";
interface UnarchiverHost extends FoundationHost {
  parse(bytes: Uint8Array): unknown;
  data(pointer: number): Uint8Array;
  contents(path: number): Promise<Uint8Array | undefined>;
  scalar(value: unknown): number;
  classNamed(name: string): number;
  hasClass(name: string): boolean;
  send(pointer: number, selector: string, args: number[]): Promise<number>;
  initializeBuiltin(
    pointer: number,
    name: string,
    fields: ArchiveFields,
    graph: ArchiveGraph,
  ): Promise<number | undefined>;
}
interface Decoder {
  graph: ArchiveGraph;
  contexts: ArchiveFields[];
  finished: boolean;
}
export function installUnarchiver(host: UnarchiverHost) {
  const decoders = new Map<number, Decoder>();
  host.hostClass(CODER, "NSObject");
  const unarchiverClass = host.hostClass(UNARCHIVER, CODER);
  function state(pointer: number) {
    const value = decoders.get(pointer);
    if (!value || value.finished) throw Error("Keyed unarchiver is not reading an archive");
    return value;
  }
  function field(pointer: number, key: number): unknown {
    const context = state(pointer).contexts.at(-1);
    const name = archiveKey(host.text(key));
    return context && Object.hasOwn(context, name) ? context[name] : undefined;
  }
  function initializeArchive(pointer: number, source: unknown) {
    if (decoders.has(pointer)) throw Error("Keyed unarchiver initialized twice");
    const contexts: ArchiveFields[] = [];
    const graph = new ArchiveGraph(source, {
      scalar: (value) => host.retain(host.scalar(value)),
      allocate: (name) => host.alloc(host.classNamed(name)),
      hasClass: (name) => host.hasClass(name),
      release: (value) => host.release(value),
      async initialize(object, name, fields) {
        contexts.push(fields);
        try {
          const builtin = await host.initializeBuiltin(object, name, fields, graph);
          return builtin ?? (await host.send(object, "initWithCoder:", [pointer]));
        } finally {
          contexts.pop();
        }
      },
    });
    contexts.push(graph.top);
    decoders.set(pointer, { graph, contexts, finished: false });
    return pointer;
  }
  async function root(bytes: Uint8Array | undefined) {
    if (!bytes) return 0;
    const coder = host.alloc(unarchiverClass);
    try {
      initializeArchive(coder, host.parse(bytes));
      const decoder = state(coder);
      return host.autorelease(host.retain(await decoder.graph.decode(decoder.graph.top.root)));
    } finally {
      await host.release(coder);
    }
  }
  host.method(UNARCHIVER, true, "unarchiveObjectWithFile:", async (_, args) =>
    root(await host.contents(args(Argument.First))),
  );
  host.method(UNARCHIVER, true, "unarchiveObjectWithData:", (_, args) =>
    root(host.data(args(Argument.First))),
  );
  host.method(UNARCHIVER, false, "initForReadingWithData:", (self, args) =>
    initializeArchive(self, host.parse(host.data(args(Argument.First)))),
  );
  host.method(UNARCHIVER, false, "allowsKeyedCoding", () => 1);
  host.method(UNARCHIVER, false, "containsValueForKey:", (self, args) =>
    Number(field(self, args(Argument.First)) !== undefined),
  );
  host.method(UNARCHIVER, false, "decodeObjectForKey:", (self, args) =>
    state(self).graph.decode(field(self, args(Argument.First))),
  );
  installScalars(host, field);
  host.method(UNARCHIVER, false, "finishDecoding", (self) => {
    state(self).finished = true;
  });
  host.method(UNARCHIVER, false, "dealloc", async (self) => {
    const decoder = decoders.get(self);
    decoders.delete(self);
    try {
      await decoder?.graph.dispose();
    } finally {
      host.destroy(self);
    }
  });
  return {
    open: (source: unknown) => openArchive(host, unarchiverClass, initializeArchive, state, source),
  };
}
function openArchive(
  host: UnarchiverHost,
  klass: number,
  initialize: (pointer: number, source: unknown) => number,
  state: (pointer: number) => Decoder,
  source: unknown,
) {
  const pointer = host.alloc(klass);
  try {
    initialize(pointer, source);
    return { pointer, graph: state(pointer).graph };
  } catch (error) {
    host.destroy(pointer);
    throw error;
  }
}

function scalarNumber(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value === "number" || typeof value === "boolean") return Number(value);
  throw Error("Keyed archive value is not a numeric scalar");
}

function installScalars(host: UnarchiverHost, field: (pointer: number, key: number) => unknown) {
  for (const selector of ["decodeIntForKey:", "decodeInt32ForKey:", "decodeIntegerForKey:"]) {
    host.method(
      UNARCHIVER,
      false,
      selector,
      (self, args) => scalarNumber(field(self, args(Argument.First))) | 0,
    );
  }
  host.method(UNARCHIVER, false, "decodeInt64ForKey:", (self, args) => {
    const value = field(self, args(Argument.First));
    return typeof value === "bigint" ? value : BigInt(Math.trunc(scalarNumber(value)));
  });
  host.method(UNARCHIVER, false, "decodeBoolForKey:", (self, args) =>
    Number(scalarNumber(field(self, args(Argument.First))) !== 0),
  );
  host.method(UNARCHIVER, false, "decodeFloatForKey:", (self, args) =>
    floatBits(scalarNumber(field(self, args(Argument.First)))),
  );
  host.method(UNARCHIVER, false, "decodeDoubleForKey:", (self, args) => {
    const bits = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
    bits.setFloat64(0, scalarNumber(field(self, args(Argument.First))), true);
    return bits.getBigUint64(0, true);
  });
}
