import type { ArchiveFields, ArchiveGraph } from "../../foundation/archives/graph";
import { objectResult } from "../host";
import { parseNib } from "./archive";
import { keyedNib, NibKey } from "./keyed-archive";
import type { NibHost } from "./host";
const PROXY_CLASS = "UIProxyObject";
const OUTLET_CLASS = "UIRuntimeOutletConnection";
/** A target-action connection from a control to its target, for UIEventMask events. */
const EVENT_CLASS = "UIRuntimeEventConnection";
const MAIN_NIB_KEY = "NSMainNibFile";
const EVENT_KEY = "RetroveNibEventConnection";
const BINARY_PLIST = new TextEncoder().encode("bplist00");
function binaryPlist(bytes: Uint8Array): boolean {
  return BINARY_PLIST.every((byte, index) => bytes[index] === byte);
}
export class NibLoader {
  private readonly owners = new WeakMap<ArchiveGraph, number>();
  private readonly connections = new Map<number, ArchiveFields>();
  private readonly roots = new Set<number>();
  constructor(private readonly host: NibHost) {
    host.hostClass(PROXY_CLASS, "NSObject");
    for (const name of [OUTLET_CLASS, EVENT_CLASS]) {
      host.hostClass(name, "NSObject");
      host.method(name, false, "dealloc", (self) => {
        this.connections.delete(self);
        host.destroy(self);
      });
    }
  }
  async initialize(
    self: number,
    name: string,
    fields: ArchiveFields,
    graph: ArchiveGraph,
  ): Promise<number | undefined> {
    if (fields[NibKey.CustomObject]) return objectResult(await this.host.send(self, "init"));
    if (name === PROXY_CLASS) {
      const identifier = this.host.text(await graph.decode(fields.UIProxiedObjectIdentifier));
      const owner = this.owners.get(graph);
      if (owner === undefined) throw new Error("Nib proxy decoded outside instantiation.");
      if (identifier !== "IBFilesOwner" && identifier !== "IBFirstResponder")
        throw new Error("Unsupported external nib object: " + identifier);
      this.host.destroy(self);
      return identifier === "IBFilesOwner" && owner ? this.host.retain(owner) : 0;
    }
    if (name === OUTLET_CLASS || name === EVENT_CLASS) {
      this.connections.set(self, name === EVENT_CLASS ? { ...fields, [EVENT_KEY]: true } : fields);
      return self;
    }
    return undefined;
  }
  private async connect(pointer: number, graph: ArchiveGraph): Promise<void> {
    const fields = this.connections.get(pointer);
    if (!fields) throw new Error("Unsupported nib connection.");
    const source = await graph.decode(fields.UISource),
      destination = await graph.decode(fields.UIDestination);
    const key = this.host.text(await graph.decode(fields.UILabel));
    if (!source) return;
    if (!fields[EVENT_KEY]) return this.host.setOutlet(source, key, destination);
    const mask = fields.UIEventMask;
    await this.host.send(source, "addTarget:action:forControlEvents:", [
      destination,
      this.host.selector(key),
      typeof mask === "number" ? mask : 0,
    ]);
  }
  async load(bytes: Uint8Array, owner: number): Promise<number> {
    const archive = this.host.openArchive(
      binaryPlist(bytes) ? this.host.parse(bytes) : keyedNib(parseNib(bytes)),
    );
    this.owners.set(archive.graph, owner);
    try {
      const graph = archive.graph;
      const objects = await graph.decode(graph.top[NibKey.Objects]);
      const connections = await graph.decode(graph.top[NibKey.Connections]);
      for (const connection of this.host.items(connections)) await this.connect(connection, graph);
      for (const object of this.host.items(objects))
        if (object && object !== owner) await this.host.send(object, "awakeFromNib", [], true);
      const visible = await graph.decode(graph.top[NibKey.VisibleWindows]);
      for (const window of this.host.items(visible))
        await this.host.send(window, "makeKeyAndVisible");
      const top = this.host.retain(await graph.decode(graph.top[NibKey.TopLevel])),
        items = this.host.items(top);
      for (let index = items.length - 1; index >= 0; index--) {
        const object = items[index];
        if (object && object !== owner) continue;
        items.splice(index, 1);
        if (object) await this.host.release(object);
      }
      return this.host.autorelease(top);
    } finally {
      await this.host.release(archive.pointer);
    }
  }
  async main(application: number): Promise<void> {
    const name = this.host.ipa.info[MAIN_NIB_KEY];
    if (name === undefined) return;
    if (typeof name !== "string" || !name || name.includes(".."))
      throw new Error("Invalid main nib name.");
    this.roots.add(this.host.retain(await this.named(name, application, 0)));
  }
  async named(name: string, owner: number, bundle: number): Promise<number> {
    const prefix = bundle
      ? this.host.text(objectResult(await this.host.send(bundle, "bundlePath"))).replace(/^\//, "")
      : this.host.ipa.bundlePath;
    const candidates = [`${prefix}/${name}.nib`, `${prefix}/en.lproj/${name}.nib`];
    const path = candidates.find((candidate) => this.host.ipa.has(candidate));
    if (!path) throw new Error("Nib file was not found: " + name);
    return this.load(await this.host.ipa.read(path), owner);
  }
}
