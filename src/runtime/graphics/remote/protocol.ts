/** Messages between the main thread and the execution worker that owns the WebGL context. */
export const GraphicsMessage = {
  Start: "graphics-start",
  Gates: "graphics-gates",
  Ready: "graphics-ready",
  Diagnostic: "graphics-diagnostic",
  Lost: "graphics-lost",
} as const;

export interface GraphicsStart {
  readonly type: typeof GraphicsMessage.Start;
  readonly canvas: OffscreenCanvas;
  readonly memory: WebAssembly.Memory;
  /** The execution workers' control block; heap requests ring its doorbell. */
  readonly control: SharedArrayBuffer;
  readonly channel: SharedArrayBuffer;
  readonly arena: number;
  readonly mask: number;
  readonly errorFlag: number;
  readonly bindingShadow: number;
}
/** The start message as the main thread sends it; the canvas travels in the transfer list. */
export type GraphicsStartPost = Omit<GraphicsStart, "canvas"> & { readonly canvas: Transferable };
/** Gate PCs of GL imports and their function indices, flattened as pc, index, pc, index… */
export interface GraphicsGates {
  readonly type: typeof GraphicsMessage.Gates;
  readonly gates: readonly number[];
}
export interface GraphicsReady {
  readonly type: typeof GraphicsMessage.Ready;
  readonly names: readonly string[];
}
export interface GraphicsDiagnostic {
  readonly type: typeof GraphicsMessage.Diagnostic;
  readonly level: string;
  readonly area: string;
  readonly message: string;
  readonly details?: unknown;
}
export interface GraphicsLost {
  readonly type: typeof GraphicsMessage.Lost;
}
export type FromGraphics = GraphicsReady | GraphicsDiagnostic | GraphicsLost;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
const integer = (value: unknown): value is number => Number.isInteger(value);

export function isGraphicsStart(value: unknown): value is GraphicsStart {
  return (
    record(value) &&
    value.type === GraphicsMessage.Start &&
    typeof OffscreenCanvas !== "undefined" &&
    value.canvas instanceof OffscreenCanvas &&
    value.memory instanceof WebAssembly.Memory &&
    value.control instanceof SharedArrayBuffer &&
    value.channel instanceof SharedArrayBuffer &&
    [value.arena, value.mask, value.errorFlag, value.bindingShadow].every(integer)
  );
}
export function isGraphicsGates(value: unknown): value is GraphicsGates {
  return (
    record(value) &&
    value.type === GraphicsMessage.Gates &&
    Array.isArray(value.gates) &&
    value.gates.every(integer)
  );
}
export function isFromGraphics(value: unknown): value is FromGraphics {
  if (!record(value)) return false;
  switch (value.type) {
    case GraphicsMessage.Ready:
      return Array.isArray(value.names) && value.names.every((name) => typeof name === "string");
    case GraphicsMessage.Diagnostic:
      return [value.level, value.area, value.message].every((text) => typeof text === "string");
    case GraphicsMessage.Lost:
      return true;
    default:
      return false;
  }
}
