import { touchUIKit, type TouchUIKit } from "../../../../web/touch.mjs";
import { parsePlist } from "../../formats/plist";
import { compareExchange32, store32 } from "../../memory/guest-atomics";
import { encodeBinaryPlist } from "../foundation/archives/plist-writer";
import { DataField } from "../foundation/data";
import { coreFoundation, type CoreFoundation } from "../foundation/corefoundation";
import { foundation } from "../foundation/foundation";
import type { FoundationParams } from "../foundation/host/types";
import { fileManager, type FileObjects } from "../foundation/foundation-files";
import type { FileSystemServices } from "../foundation/files/types";
import { installLocks } from "../foundation/locks";
import { installPorts, type PortRunLoops } from "../foundation/ports";
import { installScanners } from "../foundation/scanner-host";
import { installStringSearch } from "../foundation/string-search";
import { decodeText } from "../foundation/text/encoding";
import { securityImports } from "../security/bindings";
import { KEYCHAIN_FILE } from "../security/constants";
import type { Application } from "./application";
import type { ObjcCore } from "./core";
import { isKind, standardHost } from "./core";
import type { DisplayLinks } from "./display-links";
import type { HostMethod, HostResult } from "./host";
import { requiredGate, type ResolvedOptions } from "./runtime-types";
import type { FoundationObjects } from "./late-bindings";

const INSTRUCTION_QUALIFIERS = /^[rnNoORV]+/;
export interface FoundationFrameworks {
  readonly input: TouchUIKit;
  readonly ports: PortRunLoops;
  readonly foundation: FoundationObjects;
  readonly cf: CoreFoundation;
  readonly files: FileObjects;
  readonly security: ReturnType<typeof securityImports>;
  readonly equalObjects: (first: number, second: number) => Promise<number>;
  readonly hashObject: (pointer: number) => number | Promise<HostResult>;
}
/** UIKit input over the page, the class name of an object and the movie that backs a view. */
function installInput(core: ObjcCore, application: Application): TouchUIKit {
  const { registry, ownership, memory, strings, late, options, platform } = core;
  return touchUIKit({
    glPresented: options.glPresented,
    screen: application.profile.screen,
    movieVideo: (view: number) => late.movies().videoForView(view),
    currentThread: ownership.threadId,
    className: (pointer: number) => registry.classes.get(memory.read(pointer))?.name ?? "unknown",
    getOrientation: () => application.statusBar.orientation,
    getCoreGraphics: () => ownership.coreGraphics,
    ...standardHost(core),
    names: registry.names,
    releaseFromHost: ownership.releaseFromHost,
    lookup: registry.lookup,
    selector: registry.selector,
    selectorName: memory.cString,
    read: memory.read,
    readBytes: memory.bytes,
    loadNib: (name: string, owner: number, bundle: number) =>
      late.nibs().named(name, owner, bundle),
    readFile: (path: string) => late.files().contents(strings.string(path)),
    graphics: platform.graphics,
    signal: platform.signal,
    ipa: core.ipa,
    mediaHost: options.mediaHost,
    diagnostic: options.diagnostic,
  });
}
/** Scanners, string search, locks and ports, which wait on run-loop sources installed later. */
function installSynchronization(core: ObjcCore): PortRunLoops {
  const { registry, ownership, memory, messenger, late, guest } = core;
  const host = standardHost(core);
  const characterSets = installScanners(host);
  installStringSearch(
    {
      text: core.strings.text,
      write: memory.write,
      structureMethod: (selector, implementation) => {
        registry.method(
          "NSString",
          false,
          selector,
          Object.assign(implementation, { stret: true as const }),
        );
      },
    },
    characterSets,
  );
  const waitMethod = (name: string, selector: string, implementation: HostMethod) =>
    registry.method(name, false, selector, implementation);
  installLocks({
    ...host,
    read: memory.read,
    compareExchange: (pointer, expected, value) =>
      compareExchange32(guest.cpu, pointer, expected, value),
    store: (pointer, value) => store32(guest.cpu, pointer, value),
    currentThread: ownership.threadId,
    waitMethod,
  });
  return installPorts({
    ...host,
    hasPendingSource: (loop, mode) =>
      late.scheduler().hasThreadSource(ownership.threadId(), mode) ||
      !!late.bindings.runLoopSources?.signaled(loop, mode),
    hasRunLoopSource: (loop, mode) => !!late.bindings.runLoopSources?.has(loop, mode),
    pollSources: async (loop, mode) => {
      const delivered = await late.scheduler().pollThread(ownership.threadId(), mode);
      const connected = await late.foundation().pollConnections(loop, mode);
      return (await late.bindings.runLoopSources?.perform(loop, mode)) || connected || delivered;
    },
    send: messenger.send,
    waitMethod,
  });
}
function installFoundation(
  core: ObjcCore,
  input: TouchUIKit,
  displays: DisplayLinks,
): FoundationObjects {
  const { registry, ownership, memory, strings, late, guest, options } = core;
  const params: FoundationParams = {
    hostClass: registry.hostClass,
    method: registry.method,
    alloc: ownership.alloc,
    destroy: ownership.destroy,
    retain: ownership.retain,
    autorelease: ownership.autorelease,
    text: strings.text,
    string: strings.string,
    write: memory.write,
    send: core.messenger.send,
    cpu: guest.cpu,
    heap: guest.heap,
    names: registry.names,
    read: memory.read,
    utf8: strings.utf8,
    lookup: registry.lookup,
    selector: registry.selector,
    array: input.array,
    items: input.items,
    threads: guest.threads,
    ipa: core.ipa,
    isKind: (pointer, name) => isKind(core, pointer, name),
    getDispatch: () => late.bindings.dispatch,
    callBlock: guest.callGuest,
    dataFrom: core.data.createData,
    getRunLoop: displays.getRunLoop,
    makeString: strings.makeString,
    hostGate: options.hostGate,
    webViews: input.webViews,
    diagnostic: options.diagnostic,
    getCFEntries: (pointer) => late.bindings.coreFoundation?.dictionaryEntries(pointer),
    returnType: (self, name) => {
      const types = registry.typeEncoding(registry.lookup(memory.read(self), name));
      if (!types) throw new Error("Missing invocation method signature for " + name);
      return types.replace(INSTRUCTION_QUALIFIERS, "").charAt(0);
    },
    release: ownership.releaseFromHost,
  };
  return foundation(params);
}
/** The libc services files reach lazily, as the original host object did. */
function systemServices(options: ResolvedOptions): FileSystemServices {
  const sys = (): FileSystemServices => {
    if (!options.sys) throw new TypeError("Cannot read properties of undefined (reading 'funcs')");
    return options.sys;
  };
  return {
    get funcs() {
      return sys().funcs;
    },
    setMetadata: (path, update) => sys().setMetadata(path, update),
  };
}
/** Foundation, CoreFoundation, files and the keychain, in the order their classes register. */
export function installFoundationFrameworks(
  core: ObjcCore,
  application: Application,
  displays: DisplayLinks,
): FoundationFrameworks {
  const { registry, ownership, memory, strings, messenger, late, guest, options } = core;
  const input = (late.bindings.input = installInput(core, application));
  const ports = installSynchronization(core);
  const objects = (late.bindings.foundation = installFoundation(core, input, displays));
  const quartz = () => ownership.coreGraphics;
  const equalObjects = async (first: number, second: number) =>
    first === second
      ? 1
      : Number(
          quartz()?.equal?.(first, second) ?? (await messenger.send(first, "isEqual:", [second])),
        );
  const hashObject = (pointer: number) =>
    quartz()?.hash?.(pointer) ?? messenger.send(pointer, "hash");
  const host = standardHost(core);
  const cf = (late.bindings.coreFoundation = coreFoundation({
    ...host,
    cpu: guest.cpu,
    read: memory.read,
    zero: memory.zero,
    names: registry.names,
    callGuest: guest.callGuest,
    hostGate: (binding, implementation) => requiredGate(options.hostGate)(binding, implementation),
    release: ownership.releaseFromHost,
    makeString: strings.makeString,
    makeUTF16: strings.makeUTF16,
    foundation: {
      description: objects.description,
      number: objects.number,
      unbox: objects.unbox,
      get: objects.get,
      associated: (pointer, key, value) =>
        objects.associated(pointer, key, value) ?? Promise.resolve(),
    },
    items: input.items,
    getRunLoop: displays.getRunLoop,
    equal: equalObjects,
    hash: hashObject,
  }));
  const files = (late.bindings.files = fileManager({
    ...host,
    cpu: guest.cpu,
    heap: guest.heap,
    sys: systemServices(options),
    names: registry.names,
    utf8: strings.utf8,
    read: memory.read,
    array: input.array,
    property: objects.property,
    dataFrom: core.data.createData,
    decodeText,
    makeString: strings.makeString,
    entries: objects.archiveEntries,
    isKind: (pointer: number, name: string) => isKind(core, pointer, name),
  }));
  const security = securityImports({
    entries: (pointer) => cf.dictionaryEntries(pointer) ?? objects.archiveEntries(pointer),
    isKind: (pointer, name) => isKind(core, pointer, name),
    text: strings.text,
    bytes: (pointer) =>
      memory.bytes(memory.read(pointer + DataField.Bytes), memory.read(pointer + DataField.Length)),
    send: messenger.send,
    property: objects.property,
    retain: ownership.retain,
    write: memory.write,
    read: async () => {
      const bytes = await files.contents(strings.string(KEYCHAIN_FILE));
      return bytes ? parsePlist(bytes) : [];
    },
    save: (items) => files.writeArchive(strings.string(KEYCHAIN_FILE), encodeBinaryPlist(items)),
  });
  return { input, ports, foundation: objects, cf, files, security, equalObjects, hashObject };
}
