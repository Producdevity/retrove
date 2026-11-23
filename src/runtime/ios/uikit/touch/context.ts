import type { CoreGraphics } from "../../../graphics/core-graphics/coregraphics";
import type { Diagnostic, IpaArchive } from "../../package/ipa";
import type { GuestArguments, HostResult } from "../../objc/host";
import type { HostRegistrar, Implementation, StructureRegistrar } from "../../objc/registrars";
import { Late } from "../../late";
import type { ScreenSize } from "../screen";
import type { installAnimationGroups } from "../animation/groups";
import type { installBasicAnimations } from "../animation/basic";
import type { installTransactions } from "../animation/transactions";
import type { installAlerts } from "../alerts/bindings";
import type { installLabels } from "../label-host";
import type { installPickers } from "../picker/bindings";
import type { installControls } from "../control-host";
import type { installToolbars } from "../toolbar/bindings";
import type { installPageControls } from "../page-control/bindings";
import type { installSegmentedControls } from "../segmented-control/bindings";
import type { installSwitches } from "../switch";
import type { WebViews } from "../web-view";
import type { installTextFields } from "../text-field/bindings";
import type { installScrollViews } from "../scroll/bindings";
import type { installTables } from "../table/bindings";
import type { installColors } from "../colors";
import type { installControllerNibs } from "../nib/controllers";
import type { UiImages } from "../../../../../web/uikit-images.mjs";
import type { ViewKit } from "./kit";
import type { Geometry } from "./geometry";
import type { Collections } from "./collections";
import type { UiHelpers } from "./helpers";
import { InputMetrics } from "../../../diagnostics/input-metrics";
import type { PointerSample } from "./pointer-queue";
import { PointerQueue } from "./pointer-queue";
import type { PointLike, ViewAnimation, ViewData } from "./view-data";

export interface TouchParams {
  screen?: ScreenSize | undefined;
  hostClass: (name: string, parent: string, size?: number) => number;
  method: HostRegistrar & StructureRegistrar;
  names: Map<string, number>;
  alloc: (classPointer: number) => number;
  destroy: (pointer: number) => void;
  autorelease: (pointer: number) => number;
  retain: (pointer: number) => number;
  releaseFromHost: (pointer: number) => Promise<void>;
  send: (
    self: number,
    selector: string,
    args?: number[],
    optional?: boolean,
  ) => Promise<HostResult>;
  lookup: (classPointer: number, selector: string) => Implementation;
  selector: (name: string) => number;
  selectorName: (pointer: number) => string;
  className: (pointer: number) => string;
  read: (address: number) => number;
  write: (address: number, value: number) => void;
  readBytes: (address: number, size: number) => Uint8Array;
  graphics: () => { canvas: HTMLCanvasElement | OffscreenCanvas };
  signal?: AbortSignal | undefined;
  text: (pointer: number) => string;
  string: (value: string) => number;
  ipa: Pick<IpaArchive, "info" | "bundlePath" | "has" | "read">;
  mediaHost?: HTMLElement | undefined;
  getCoreGraphics: () => CoreGraphics | undefined;
  getOrientation: () => number;
  diagnostic?: Diagnostic | undefined;
  loadNib: (name: string, owner: number, bundle: number) => Promise<number>;
  readFile: (path: string) => Promise<Uint8Array | undefined>;
  currentThread?: (() => number) | undefined;
  movieVideo?: ((view: number) => unknown) | undefined;
  glPresented?: (() => boolean) | undefined;
}

export const NO_ARGUMENTS: GuestArguments = () => 0;

export function classPointer(names: ReadonlyMap<string, number>, name: string): number {
  const pointer = names.get(name);
  if (!pointer) throw new Error(`Unknown UIKit class ${name}`);
  return pointer;
}

export interface TouchRecord {
  ptr: number;
  window: number;
  target: number;
  taps: number;
  point: PointLike;
  down: PointerSample;
  deferred: boolean;
  phase: number;
  previous: PointLike;
  time: number;
  pan?: boolean;
  panView?: number;
}
export interface TapRecord {
  target: number;
  taps: number;
  time: number;
  point: PointLike;
}
export interface TouchState {
  readonly views: Map<number, ViewData>;
  readonly controllerViews: Map<number, number>;
  readonly touches: Map<number, TouchRecord>;
  readonly collections: Map<number, number[]>;
  readonly eventTouches: Map<number, number>;
  readonly active: Map<number, TouchRecord>;
  readonly queue: PointerQueue;
  readonly inputMetrics: InputMetrics;
  readonly ignoredPointers: Set<number>;
  window: number;
  screen: number;
  canvas: HTMLCanvasElement | null | undefined;
  events: AbortController | undefined;
  previousTap: TapRecord | undefined;
  animation: ViewAnimation | undefined;
  ignoring: number;
}
export function createTouchState(): TouchState {
  return {
    views: new Map(),
    controllerViews: new Map(),
    touches: new Map(),
    collections: new Map(),
    eventTouches: new Map(),
    active: new Map(),
    queue: new PointerQueue(),
    inputMetrics: new InputMetrics(),
    ignoredPointers: new Set(),
    window: 0,
    screen: 0,
    canvas: undefined,
    events: undefined,
    previousTap: undefined,
    animation: undefined,
    ignoring: 0,
  };
}

export interface Services {
  animationGroups: Late<ReturnType<typeof installAnimationGroups>>;
  basicAnimations: Late<ReturnType<typeof installBasicAnimations>>;
  transactions: Late<ReturnType<typeof installTransactions>>;
  alerts: Late<ReturnType<typeof installAlerts>>;
  textViews: Late<ReturnType<typeof installLabels>>;
  pickerViews: Late<ReturnType<typeof installPickers>>;
  controls: Late<ReturnType<typeof installControls>>;
  toolbars: Late<ReturnType<typeof installToolbars>>;
  pageControls: Late<ReturnType<typeof installPageControls>>;
  segmentedControls: Late<ReturnType<typeof installSegmentedControls>>;
  switches: Late<ReturnType<typeof installSwitches>>;
  webViews: Late<WebViews>;
  textFields: Late<ReturnType<typeof installTextFields>>;
  scrollers: Late<ReturnType<typeof installScrollViews>>;
  tables: Late<ReturnType<typeof installTables>>;
  uiColors: Late<ReturnType<typeof installColors>>;
  imageViews: Late<UiImages>;
  controllerNibs: Late<ReturnType<typeof installControllerNibs>>;
}
export function createServices(): Services {
  return {
    animationGroups: new Late("UIKit animation groups"),
    basicAnimations: new Late("UIKit basic animations"),
    transactions: new Late("UIKit transactions"),
    alerts: new Late("UIKit alerts"),
    textViews: new Late("UIKit labels"),
    pickerViews: new Late("UIKit pickers"),
    controls: new Late("UIKit controls"),
    toolbars: new Late("UIKit toolbars"),
    pageControls: new Late("UIKit page controls"),
    segmentedControls: new Late("UIKit segmented controls"),
    switches: new Late("UIKit switches"),
    webViews: new Late("UIKit web views"),
    textFields: new Late("UIKit text fields"),
    scrollers: new Late("UIKit scroll views"),
    tables: new Late("UIKit tables"),
    uiColors: new Late("UIKit colors"),
    imageViews: new Late("UIKit images"),
    controllerNibs: new Late("UIKit controller nibs"),
  };
}
export interface TouchBase extends TouchParams {
  readonly glPresented: () => boolean;
  readonly phoneScreen: ScreenSize;
  readonly state: TouchState;
  readonly services: Services;
}
export interface TouchContext extends TouchBase {
  readonly kit: ViewKit;
  readonly geo: Geometry;
  readonly collections: Collections;
}
export interface UiContext extends TouchContext {
  readonly helpers: UiHelpers;
  readonly deallocObject: (self: number) => Promise<void>;
  readonly deallocateView: (self: number) => Promise<void>;
}
