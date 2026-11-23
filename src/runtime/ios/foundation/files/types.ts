import type { GuestMemory } from "../../../memory/guest-memory";
import type { GuestHeap } from "../../libc/guest-imports";
import type { SystemImport } from "../../libc/system/types";
import type { FoundationHost, HostResult } from "../../objc/host";
import type { FileMetadata } from "../file-attributes";

export interface FileSystemServices {
  readonly funcs: Readonly<Record<string, SystemImport>>;
  readonly setMetadata: (path: string, update: FileMetadata) => Promise<number>;
}
export interface FileManagerHost {
  readonly cpu: GuestMemory;
  readonly heap: GuestHeap;
  readonly sys: FileSystemServices;
  readonly hostClass: FoundationHost["hostClass"];
  readonly method: FoundationHost["method"];
  readonly names: ReadonlyMap<string, number>;
  readonly alloc: (classPointer: number) => number;
  readonly destroy: (pointer: number) => void;
  readonly retain: (pointer: number) => number;
  readonly release: (pointer: number) => Promise<void>;
  readonly autorelease: (pointer: number) => number;
  readonly string: (value: string, mutable?: boolean) => number;
  readonly text: (pointer: number) => string;
  readonly utf8: (pointer: number) => number;
  readonly write: (address: number, value: number) => void;
  readonly read: (address: number) => number;
  readonly array: (values: number[], mutable?: boolean) => number;
  readonly send: (self: number, selector: string, args?: number[]) => Promise<HostResult>;
  readonly property: (value: unknown, mutability?: number) => number;
  readonly dataFrom: (source: number, count: number, target?: number) => number;
  readonly decodeText: (bytes: Uint8Array, encoding: number) => string | null;
  readonly makeString: (value: string, target?: number) => number;
  readonly entries: (dictionary: number) => ReadonlyArray<readonly [number, number]>;
  readonly isKind: (self: number, className: string) => boolean;
}
export interface FileObjects {
  /** The bytes of the file at an NSString path, or undefined when it does not exist. */
  contents(path: number): Promise<Uint8Array | undefined>;
  /** An autoreleased NSError. */
  error(code: number, domain: string): number;
  writeArchive(path: number, bytes: Uint8Array): Promise<boolean>;
}
