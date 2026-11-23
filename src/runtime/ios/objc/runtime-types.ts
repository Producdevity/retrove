import type { GuestCPU } from "../../cpu/cpu";
import type { Drawable, DrawableGeometry } from "../../graphics/drawable";
import type { GraphicsContext } from "../../graphics/gl-parameters";
import type { FileSystemServices } from "../foundation/files/types";
import type { Diagnostic } from "../package/ipa";
import type { Heap } from "../../memory/guest-memory";
import type { GuestArguments, HostMethod, HostResult, StructureMethod } from "./host";

export type ObjcMethod = HostMethod | StructureMethod;
/** A guest IMP address or a host implementation. */
export type MethodValue = number | ObjcMethod;
export type MethodTable = Map<string, MethodValue>;
export interface ClassRecord {
  readonly name: string;
  readonly pointer: number;
  readonly isMeta: boolean;
  /** The class object a metaclass belongs to; the class itself otherwise. */
  readonly owner: number;
  readonly size: number;
  /** Framework classes the app links but Retrove does not implement are unsupported. */
  readonly supported: boolean;
  readonly methods: MethodTable;
}
export type ObjcHeap = Pick<Heap, "alloc" | "free" | "zero" | "string">;
export interface GuestCall {
  (entry: number, args: number[]): Promise<number>;
  (entry: number, args: number[], wide: boolean): Promise<number | bigint>;
}
export interface GuestThreads {
  readonly funcs: { _pthread_self(): number };
  readonly remote?: unknown;
  readonly onExit?: (listener: (thread: number) => Promise<void>) => void;
  readonly idle: (work: Promise<number>) => Promise<number>;
  readonly spawnDetached: (entry: number, args: number[], exited: () => Promise<void>) => number;
}
export interface HostBinding {
  readonly name: string;
  readonly library?: string;
}
/** Gives a host implementation a guest-callable address. */
export type HostGate = (
  binding: HostBinding,
  implementation: (args: GuestArguments) => unknown,
) => number;
export interface ObjcExceptionRuntime {
  readonly objcType: (name: string, classPointer: number) => number;
  readonly throwObjC: (
    exception: number,
    uncaught: () => Promise<void>,
  ) => HostResult | Promise<HostResult>;
}
export interface DispatchService {
  readonly copy: (block: number) => Promise<number>;
  readonly release: (block: number) => Promise<void>;
  readonly hasPendingMain?: () => boolean;
}
export type LifecycleListener = (phase: string, details?: Record<string, unknown>) => void;
export interface ObjcOptions {
  onPresent?: (presented: number, duration: number) => void;
  onLifecycle?: LifecycleListener;
  diagnostic?: Diagnostic;
  glPresented?: () => boolean;
  mediaHost?: HTMLElement;
  needsMovieResume?: (needed: boolean) => void;
  threads?: GuestThreads;
  sys?: FileSystemServices;
  audio?: { setSessionActive(active: boolean): number };
  audioOutput?: () => AudioContext | null;
  hostGate?: HostGate;
  cxx?: ObjcExceptionRuntime;
  drawable?: (geometry: DrawableGeometry) => Drawable;
}
/** The options with the defaults the runtime applies when a caller leaves them out. */
export type ResolvedOptions = Omit<ObjcOptions, "drawable"> &
  Required<Pick<ObjcOptions, "onPresent" | "onLifecycle" | "diagnostic" | "audioOutput">>;
/** Host frame time the run loop hands back to other guest work, and whether it must yield now. */
export type ServiceSlice = (milliseconds: number, yieldNow: boolean) => Promise<void>;
/** The WebGL context of the page canvas UIKit lays out over. */
export type PageGraphics = GraphicsContext & { readonly canvas: HTMLCanvasElement };
/** The page the runtime draws into and the signal that stops the application. */
export interface ObjcPlatform {
  readonly graphics: () => PageGraphics;
  readonly signal: AbortSignal | undefined;
  readonly service: ServiceSlice;
}
/** The guest the Objective-C runtime models: its CPU, heap and nested guest calls. */
export interface ObjcGuest {
  readonly cpu: GuestCPU;
  readonly heap: ObjcHeap;
  readonly callGuest: GuestCall;
  readonly threads: GuestThreads | undefined;
}
/** Messaging and ownership that every Objective-C bridge relies on. */
export interface MessageHost {
  readonly send: (
    self: number,
    name: string,
    args?: number[],
    optional?: boolean,
  ) => Promise<HostResult>;
  readonly lookup: (start: number, name: string) => MethodValue | null;
}
export function returnsStructure(method: ObjcMethod): method is StructureMethod {
  return "stret" in method && Boolean(method.stret);
}
/** The object pointer a message returned; void and other non-word results are nil. */
export function pointerResult(value: HostResult): number {
  return typeof value === "number" ? value : 0;
}
/** A service the runtime wires after the code that refers to it, as the original closures did. */
export function initialized<T>(value: T | undefined, name: string): T {
  if (value === undefined)
    throw new ReferenceError(`Cannot access '${name}' before initialization`);
  return value;
}
/** The gate a caller configured; calling a missing gate fails as the untyped runtime did. */
export function requiredGate(gate: HostGate | undefined): HostGate {
  if (!gate) throw new TypeError("hostGate is not a function");
  return gate;
}
