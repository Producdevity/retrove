import { Argument, type FoundationHost } from "../../objc/host";
import { floatFromBits } from "../../abi/scalars";
import { ArchiveEncoder } from "./encoder";
import { encodeBinaryPlist } from "./plist-writer";
import { archiveKey, type ArchiveFields } from "./graph";

const ARCHIVER = "NSKeyedArchiver";
interface ArchiverHost extends FoundationHost {
  classes(pointer: number): string[];
  scalar(pointer: number): string | number | boolean | bigint | undefined;
  builtin(
    pointer: number,
    name: string,
    fields: ArchiveFields,
    encoder: ArchiveEncoder,
  ): Promise<boolean>;
  send(pointer: number, selector: string, args: number[]): Promise<number>;
  data(bytes: Uint8Array): number;
  replaceData(pointer: number, bytes: Uint8Array): void;
  writeFile(path: number, bytes: Uint8Array): Promise<boolean>;
}
interface EncoderState {
  graph: ArchiveEncoder;
  contexts: ArchiveFields[];
  data: number;
  finished: boolean;
}
export function installArchiver(host: ArchiverHost) {
  const archiverClass = host.hostClass(ARCHIVER, "NSCoder");
  const states = new Map<number, EncoderState>();
  function state(pointer: number) {
    const value = states.get(pointer);
    if (!value || value.finished) throw Error("Keyed archiver is not writing an archive");
    return value;
  }
  function initialize(pointer: number, data = 0) {
    if (states.has(pointer)) throw Error("Keyed archiver initialized twice");
    const contexts: ArchiveFields[] = [];
    const graph = new ArchiveEncoder({
      classes: (p) => host.classes(p),
      scalar: (p) => host.scalar(p),
      async encode(object, name, fields) {
        contexts.push(fields);
        try {
          if (!(await host.builtin(object, name, fields, graph)))
            await host.send(object, "encodeWithCoder:", [pointer]);
        } finally {
          contexts.pop();
        }
      },
    });
    contexts.push(graph.top);
    states.set(pointer, { graph, contexts, data: host.retain(data), finished: false });
    return pointer;
  }
  async function root(pointer: number) {
    const coder = initialize(host.alloc(archiverClass));
    try {
      const { graph } = state(coder);
      graph.top.root = await graph.encode(pointer);
      return encodeBinaryPlist(graph.finish());
    } finally {
      await host.release(coder);
    }
  }
  host.method(ARCHIVER, true, "archivedDataWithRootObject:", async (_, args) =>
    host.data(await root(args(Argument.First))),
  );
  host.method(ARCHIVER, true, "archiveRootObject:toFile:", async (_, args) =>
    Number(await host.writeFile(args(Argument.Second), await root(args(Argument.First)))),
  );
  host.method(ARCHIVER, false, "initForWritingWithMutableData:", (self, args) =>
    initialize(self, args(Argument.First)),
  );
  host.method(ARCHIVER, false, "allowsKeyedCoding", () => 1);
  installValues(host, state);
  host.method(ARCHIVER, false, "finishEncoding", (self) => {
    if (states.get(self)?.finished) return;
    const value = state(self);
    host.replaceData(value.data, encodeBinaryPlist(value.graph.finish()));
    value.finished = true;
  });
  host.method(ARCHIVER, false, "dealloc", async (self) => {
    const value = states.get(self);
    states.delete(self);
    try {
      await host.release(value?.data ?? 0);
    } finally {
      host.destroy(self);
    }
  });
}
function installValues(host: ArchiverHost, state: (pointer: number) => EncoderState) {
  function context(pointer: number) {
    const fields = state(pointer).contexts.at(-1);
    if (!fields) throw Error("Missing archive encoding context");
    return fields;
  }
  const set = (pointer: number, key: number, value: unknown) => {
    const name = archiveKey(host.text(key)),
      fields = context(pointer);
    if (Object.hasOwn(fields, name)) throw Error("Duplicate keyed archive key " + name);
    Object.defineProperty(fields, name, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  };
  host.method(ARCHIVER, false, "encodeObject:forKey:", async (self, args) => {
    const key = args(Argument.Second);
    const value = await state(self).graph.encode(args(Argument.First));
    set(self, key, value);
  });
  host.method(ARCHIVER, false, "encodeConditionalObject:forKey:", (self, args) => {
    set(self, args(Argument.Second), undefined);
    state(self).graph.encodeConditional(
      context(self),
      archiveKey(host.text(args(Argument.Second))),
      args(Argument.First),
    );
  });
  for (const selector of ["encodeInt:forKey:", "encodeInt32:forKey:", "encodeInteger:forKey:"])
    host.method(ARCHIVER, false, selector, (self, args) =>
      set(self, args(Argument.Second), args(Argument.First) | 0),
    );
  host.method(ARCHIVER, false, "encodeBool:forKey:", (self, args) =>
    set(self, args(Argument.Second), Boolean(args(Argument.First))),
  );
  host.method(ARCHIVER, false, "encodeFloat:forKey:", (self, args) =>
    set(self, args(Argument.Second), floatFromBits(args(Argument.First))),
  );
  for (const [selector, kind] of [
    ["encodeDouble:forKey:", "double"],
    ["encodeInt64:forKey:", "integer"],
  ] as const)
    host.method(ARCHIVER, false, selector, (self, args) => {
      const bits = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
      bits.setUint32(0, args(Argument.First), true);
      bits.setUint32(Uint32Array.BYTES_PER_ELEMENT, args(Argument.Second), true);
      set(
        self,
        args(Argument.Third),
        kind === "double" ? bits.getFloat64(0, true) : bits.getBigInt64(0, true),
      );
    });
}
