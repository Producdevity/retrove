import { WORD_BYTES } from "../abi/scalars";
import { ClassField } from "./class-registry";
import type { ObjcCore } from "./core";
import type { Protocols } from "./invocation-calls";
import type { MethodTable, MethodValue } from "./runtime-types";

/** category_t: name, class, then instance and class method lists. */
const CategoryField = { Class: 4, InstanceMethods: 8, ClassMethods: 12 } as const;
const LOAD = "load";
interface ObjcSection {
  readonly name: string;
  readonly address: number;
  readonly size: number;
}
/** The parts of a loaded Mach-O image the runtime reads its Objective-C metadata from. */
export interface ObjcImage {
  readonly segments: readonly { readonly sections: readonly ObjcSection[] }[];
}
interface LoadCall {
  readonly cls: number;
  readonly implementation: MethodValue | undefined;
}
export interface ImageLoader {
  /** Registers an image's selectors, classes, protocols and categories. */
  readonly install: (image: ObjcImage) => void;
  /** Runs the +load methods of the installed images in load order. */
  readonly start: () => Promise<void>;
}
function categoryLoader(
  { memory, registry }: ObjcCore,
  loads: LoadCall[],
  nonLazyCategories: ReadonlySet<number>,
) {
  return (category: number) => {
    const cls = memory.read(category + CategoryField.Class);
    const info = registry.classes.get(cls);
    if (!info) throw new Error("Unknown class in Objective-C category");
    registry.loadMethods(memory.read(category + CategoryField.InstanceMethods), info.methods);
    const methods: MethodTable = new Map();
    registry.loadMethods(memory.read(category + CategoryField.ClassMethods), methods);
    const metaclass = registry.record(memory.read(cls));
    for (const [name, implementation] of methods) metaclass.methods.set(name, implementation);
    if (nonLazyCategories.has(category) && methods.has(LOAD))
      loads.push({ cls, implementation: methods.get(LOAD) });
  };
}
export function imageLoader(core: ObjcCore, protocols: Protocols): ImageLoader {
  const { memory, registry, guest } = core;
  const { read } = memory;
  const loads: LoadCall[] = [];
  function install(image: ObjcImage): void {
    const sections = image.segments.flatMap((segment) => segment.sections);
    function each(sectionName: string, visit: (pointer: number, at: number) => void): void {
      for (const section of sections.filter((candidate) => candidate.name === sectionName)) {
        if (section.size % WORD_BYTES !== 0) throw new Error(`Invalid Objective-C ${sectionName}`);
        for (let at = section.address; at < section.address + section.size; at += WORD_BYTES)
          visit(read(at), at);
      }
    }
    each("__objc_selrefs", (pointer, at) => {
      const name = memory.cString(pointer);
      registry.referencedSelectors.add(name);
      memory.write(at, registry.selector(name));
    });
    each("__objc_classlist", (pointer) => registry.register(pointer, false, pointer));
    const loaded = new Set<number>();
    function queueClass(pointer: number): void {
      if (!pointer || loaded.has(pointer)) return;
      loaded.add(pointer);
      queueClass(read(pointer + ClassField.Superclass));
      const implementation = registry.classes.get(read(pointer))?.methods.get(LOAD);
      if (typeof implementation === "number") loads.push({ cls: pointer, implementation });
    }
    each("__objc_protolist", (pointer) => protocols.register(pointer));
    each("__objc_protorefs", (pointer) => protocols.register(pointer));
    each("__objc_nlclslist", (pointer) => queueClass(pointer));
    const nonLazyCategories = new Set<number>();
    each("__objc_nlcatlist", (category) => nonLazyCategories.add(category));
    each("__objc_catlist", categoryLoader(core, loads, nonLazyCategories));
  }
  return {
    install,
    async start() {
      for (const { cls, implementation } of loads) {
        if (typeof implementation !== "number")
          throw new TypeError("Objective-C +load is not a guest function");
        await guest.callGuest(implementation, [cls, registry.selector(LOAD)]);
      }
    },
  };
}
