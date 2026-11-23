import type { ClassRegistry } from "./class-registry";
import type { DataObjects } from "./data-objects";
import type { GuestAccess } from "./guest-access";
import type { LateServices } from "./late-bindings";
import type { Messenger } from "./messaging";
import type { ObjectOwnership } from "./object-ownership";
import type { RootObject } from "./root-object";
import type { ObjcGuest, ObjcPlatform, ResolvedOptions } from "./runtime-types";
import type { StringObjects } from "./string-objects";
import type { IpaArchive } from "../package/ipa";

/** The guest application bundle; tests provide only the parts they read. */
export type ObjcBundle = Pick<
  IpaArchive,
  "info" | "bundlePath" | "executablePath" | "has" | "read" | "stream"
>;
/** The assembled runtime state every Objective-C bridge module builds on. */
export interface ObjcCore {
  readonly guest: ObjcGuest;
  readonly memory: GuestAccess;
  readonly registry: ClassRegistry;
  readonly ownership: ObjectOwnership;
  readonly messenger: Messenger;
  readonly strings: StringObjects;
  readonly data: DataObjects;
  readonly root: RootObject;
  readonly late: LateServices;
  readonly ipa: ObjcBundle;
  readonly options: ResolvedOptions;
  readonly platform: ObjcPlatform;
}
/** The host most Foundation and UIKit bridges take; release runs dealloc from the host. */
export interface StandardHost {
  readonly hostClass: ClassRegistry["hostClass"];
  readonly method: ClassRegistry["method"];
  readonly alloc: ObjectOwnership["alloc"];
  readonly destroy: ObjectOwnership["destroy"];
  readonly retain: ObjectOwnership["retain"];
  readonly release: ObjectOwnership["releaseFromHost"];
  readonly autorelease: ObjectOwnership["autorelease"];
  readonly text: StringObjects["text"];
  readonly string: StringObjects["string"];
  readonly write: GuestAccess["write"];
  readonly send: Messenger["send"];
}
export function standardHost({
  registry,
  ownership,
  strings,
  memory,
  messenger,
}: ObjcCore): StandardHost {
  return {
    hostClass: registry.hostClass,
    method: registry.method,
    alloc: ownership.alloc,
    destroy: ownership.destroy,
    retain: ownership.retain,
    release: ownership.releaseFromHost,
    autorelease: ownership.autorelease,
    text: strings.text,
    string: strings.string,
    write: memory.write,
    send: messenger.send,
  };
}
/** Whether an object is an instance of the named class or a subclass. */
export function isKind({ registry, memory }: ObjcCore, object: number, name: string): boolean {
  return !!object && registry.subclass(memory.read(object), registry.names.get(name) ?? 0);
}
export function responds({ registry, memory }: ObjcCore, object: number, name: string): boolean {
  return !!registry.lookup(memory.read(object), name);
}
