import type { GuestMemory } from "../src/runtime/memory/guest-memory";

type GraphicsContext = WebGLRenderingContext | WebGL2RenderingContext;
export type GlesFunction = (a: (n: number) => number) => unknown;
export interface GlesHeap {
  alloc(size: number): number;
  free(address: number): void;
  string(text: string): number;
}
export interface GlesOptions {
  readonly currentAPI?: () => number;
  readonly currentContext?: () => number;
  readonly onClose?: (close: () => void) => void;
  /** Guest word the guest's glGetError fast path reads; allocated by the caller. */
  readonly errorFlag?: number;
  /** Guest words the guest's bind fast paths read; allocated by the caller. */
  readonly bindingShadow?: number;
}
export function glesImports(
  cpu: GuestMemory,
  heap: GlesHeap,
  getContext: () => GraphicsContext | null,
  diagnostic: (level: string, area: string, message: string, details?: unknown) => void,
  options?: GlesOptions,
): Record<string, GlesFunction>;
