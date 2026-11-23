import type { GuestMemory } from "../../../memory/guest-memory";
import type { GuestArguments, HostResult } from "../../objc/host";
import type {
  HostRegistrar,
  Implementation,
  MethodRegistrar,
  StructureRegistrar,
} from "../../objc/registrars";
import type { Diagnostic, IpaArchive } from "../../package/ipa";
import { Late } from "../../late";
import type { installDates } from "../dates";
import type { FastEnumeration } from "../fast-enumeration";
import type { installDecimalNumbers } from "../decimal/bindings";
import type { NumericValue } from "../numbers";

export { Late };
export interface GuestHeap {
  alloc(bytes: number): number;
  free(address: number): void;
  zero(bytes: number): number;
  string(value: string): number;
}
export interface DispatchService {
  copy(block: number): Promise<number>;
  release(block: number): Promise<void>;
}
export interface ThreadService {
  readonly funcs: { _pthread_self(): number };
  spawnDetached(entry: number, args: number[], exited: () => Promise<void>): number;
}
export interface WebViewLoader {
  load(view: number, html: string, base: string, finished: () => void): void;
}
export type HostGate = (
  info: { name: string; library: string },
  handler: (args: GuestArguments) => Promise<number>,
) => number;

export interface FoundationParams {
  cpu: GuestMemory;
  heap: GuestHeap;
  hostClass: (name: string, parent: string, size?: number) => number;
  method: MethodRegistrar;
  names: Map<string, number>;
  alloc: (classPointer: number) => number;
  destroy: (pointer: number) => void;
  autorelease: (pointer: number) => number;
  retain: (pointer: number) => number;
  release: (pointer: number) => Promise<void>;
  read: (address: number) => number;
  write: (address: number, value: number) => void;
  string: (value: string) => number;
  text: (pointer: number) => string;
  utf8: (pointer: number) => number;
  send: (
    self: number,
    selector: string,
    args?: number[],
    optional?: boolean,
  ) => Promise<HostResult>;
  lookup: (classPointer: number, selector: string) => Implementation;
  selector: (name: string) => number;
  array: (values: number[], mutable?: boolean) => number;
  items: (pointer: number) => number[];
  threads?: ThreadService | undefined;
  ipa: Pick<IpaArchive, "info" | "bundlePath">;
  isKind: (pointer: number, className: string) => boolean;
  getDispatch: () => DispatchService | undefined;
  callBlock: (entry: number, args: number[]) => Promise<HostResult>;
  dataFrom: (source: number, length: number, self?: number) => number;
  getRunLoop: (thread?: number) => number;
  makeString: (value: string, self?: number) => number;
  hostGate?: HostGate | undefined;
  returnType: (self: number, selector: string) => string;
  getCFEntries?: ((pointer: number) => [number, number][] | undefined) | undefined;
  webViews: WebViewLoader;
  diagnostic?: Diagnostic | undefined;
}

export interface ResponseRecord {
  url: number;
  length: number | bigint | void;
  status?: number;
}
export interface FoundationState {
  dicts: Map<number, Map<string | number, [number, number]>>;
  numbers: Map<number, NumericValue>;
  urls: Map<number, URL>;
  requests: Map<number, number>;
  responses: Map<number, ResponseRecord>;
  requestProperties: Map<number, Record<string, number>>;
  mainRequests: (() => Promise<void>)[];
  enumeration: FastEnumeration;
}
export interface LateServices {
  dates: Late<ReturnType<typeof installDates>>;
  decimals: Late<ReturnType<typeof installDecimalNumbers>>;
}
export interface FoundationBase extends Omit<FoundationParams, "method"> {
  readonly method: HostRegistrar;
  readonly structureMethod: StructureRegistrar;
  readonly diagnostic: Diagnostic;
  readonly state: FoundationState;
  readonly late: LateServices;
}
export interface Helpers {
  readonly bits: DataView;
  readonly classPointer: (name: string) => number;
  readonly singleton: (name: string) => () => number;
  readonly associated: (self: number, key: number, value: number) => Promise<void> | undefined;
  readonly get: (self: number, key: number) => number;
  readonly dictionary: (cls: number, pairs: Iterable<readonly [number, number]>) => number;
  readonly number: (value: NumericValue) => number;
  readonly numberText: (pointer: number) => string;
  readonly date: (seconds: number) => number;
  readonly property: (value: unknown, mutability?: number) => number;
  readonly unbox: (pointer: number) => unknown;
  readonly plist: (pointer: number) => unknown;
  readonly description: (pointer: number) => string;
  readonly formatted: (template: number, word: (index: number) => number) => string;
  readonly languages: () => string[];
  readonly primaryLanguage: () => string;
  readonly url: (value: URL, cls?: number) => number;
  readonly fileURL: (path: string) => URL;
  readonly offlineError: (code?: number, url?: number) => number;
  readonly newUUID: (value?: string) => number;
  readonly uuidString: (pointer: number) => string;
  readonly forgetUUID: (pointer: number) => void;
  readonly entries: (pointer: number) => [number, number][];
}
export interface FoundationContext extends FoundationBase {
  readonly h: Helpers;
}
