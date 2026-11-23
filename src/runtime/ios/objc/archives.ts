import { parsePlist } from "../../formats/plist";
import { installArchiver } from "../foundation/archives/archiver";
import { archiveFoundation } from "../foundation/archives/foundation";
import { encodeFoundation } from "../foundation/archives/foundation-encoder";
import { installGeometryCoding } from "../foundation/archives/geometry-coding";
import { installUnarchiver } from "../foundation/archives/unarchiver";
import { DataField } from "../foundation/data";
import { installXMLParser } from "../foundation/xml/bindings";
import { NibLoader } from "../uikit/nib/instantiate";
import { ClassField } from "./class-registry";
import type { ObjcCore } from "./core";
import { isKind, responds, standardHost } from "./core";
import type { FoundationFrameworks } from "./foundation-frameworks";
import { connectOutlet } from "./outlets";
import { pointerResult } from "./runtime-types";

/** Messages whose result the archive bridges read as an object pointer. */
function pointerSend(core: ObjcCore) {
  return async (receiver: number, selector: string, args?: number[]): Promise<number> =>
    pointerResult(await core.messenger.send(receiver, selector, args));
}
function dataBytes({ memory }: ObjcCore, pointer: number): Uint8Array {
  return memory.bytes(
    memory.read(pointer + DataField.Bytes),
    memory.read(pointer + DataField.Length),
  );
}
/** The archived class names of an object, from its class up to the root. */
function archivedClasses({ memory, registry }: ObjcCore, pointer: number): string[] {
  const result: string[] = [],
    seen = new Set<number>();
  for (
    let cls = memory.read(pointer);
    cls && !seen.has(cls);
    cls = memory.read(cls + ClassField.Superclass)
  ) {
    seen.add(cls);
    const info = registry.classes.get(cls);
    if (!info) throw new Error("Invalid archived class");
    result.push(info.name);
  }
  return result;
}
function installXML(core: ObjcCore, frameworks: FoundationFrameworks): void {
  const { memory, ownership, data, options } = core;
  installXMLParser({
    ...standardHost(core),
    responds: (pointer, name) => !!pointer && responds(core, pointer, name),
    dataLength: (pointer) => memory.read(pointer + DataField.Length),
    readData: (pointer, length) => memory.bytes(memory.read(pointer + DataField.Bytes), length),
    data: (bytes) => ownership.autorelease(data.archivedData(bytes)),
    dictionary: (attributes) => frameworks.foundation.property(attributes),
    error: (code, domain) => frameworks.files.error(code, domain),
    diagnostic: (message, code) => options.diagnostic("warn", "xml", message, { code }),
  });
}
function installNibs(core: ObjcCore, frameworks: FoundationFrameworks): NibLoader {
  const { memory, registry, ownership, strings, data, late, ipa } = core;
  const { foundation: objects, input, files } = frameworks;
  const send = pointerSend(core);
  const initializeFoundationArchive = archiveFoundation({
    string: (pointer, value) => {
      strings.makeString(value, pointer);
    },
    number: objects.setArchivedNumber,
    date: objects.setArchivedDate,
    data: (pointer, bytes) => {
      data.archivedData(bytes, pointer);
    },
    dictionary: async (pointer, key, value) => {
      await objects.associated(pointer, key, value);
    },
    collection: (pointer, values) => {
      input.items(pointer).push(...values.map(ownership.retain));
    },
  });
  const unarchiver = installUnarchiver({
    ...standardHost(core),
    parse: parsePlist,
    contents: (path) => files.contents(path),
    data: (pointer) => dataBytes(core, pointer),
    classNamed: (name) => {
      const cls = registry.names.get(name);
      if (!cls) throw new Error(`Unknown archived class ${name}`);
      return cls;
    },
    hasClass: (name) => registry.names.has(name),
    send,
    scalar: (value) =>
      value instanceof Uint8Array
        ? ownership.autorelease(data.archivedData(value))
        : objects.property(value),
    initializeBuiltin: async (pointer, name, fields, graph) =>
      (await late.nibs().initialize(pointer, name, fields, graph)) ??
      initializeFoundationArchive(pointer, name, fields, graph),
  });
  return (late.bindings.nibs = new NibLoader({
    ...standardHost(core),
    selector: registry.selector,
    items: input.items,
    ipa,
    parse: parsePlist,
    openArchive: (source) => unarchiver.open(source),
    setOutlet: (self, key, value) =>
      connectOutlet(
        {
          read: memory.read,
          write: memory.write,
          cString: memory.cString,
          responds: (pointer, name) => responds(core, pointer, name),
          send: core.messenger.send,
          retain: ownership.retain,
          release: ownership.releaseFromHost,
        },
        self,
        key,
        value,
      ),
  }));
}
function installArchiving(core: ObjcCore, frameworks: FoundationFrameworks): void {
  const { memory, registry, ownership, strings, data } = core;
  const { foundation: objects, input, files } = frameworks;
  const send = pointerSend(core);
  installArchiver({
    ...standardHost(core),
    send,
    classes: (pointer) => archivedClasses(core, pointer),
    scalar: (pointer) =>
      isKind(core, pointer, "NSString") && !isKind(core, pointer, "NSMutableString")
        ? strings.text(pointer)
        : objects.archiveNumber(pointer),
    builtin: encodeFoundation({
      text: strings.text,
      data: (pointer) => dataBytes(core, pointer),
      date: objects.archiveDate,
      entries: objects.archiveEntries,
      items: input.items,
    }),
    data: (bytes) => ownership.autorelease(data.archivedData(bytes)),
    replaceData: (pointer, bytes) => {
      data.resizeData(pointer, bytes.length);
      memory.writeBytes(memory.read(pointer + DataField.Bytes), bytes);
    },
    writeFile: (path, bytes) => files.writeArchive(path, bytes),
  });
  installGeometryCoding({
    method: registry.method,
    string: strings.string,
    text: strings.text,
    write: memory.write,
    send,
    structure: (cls, selector, implementation) =>
      registry.method(cls, false, selector, implementation),
  });
}
/** XML parsing, keyed archives and nibs, in the order their classes register. */
export function installArchives(core: ObjcCore, frameworks: FoundationFrameworks): NibLoader {
  installXML(core, frameworks);
  const nibs = installNibs(core, frameworks);
  installArchiving(core, frameworks);
  return nibs;
}
