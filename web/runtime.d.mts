import type { Diagnostic, IpaArchive } from "./ipa.mjs";
import type { OffscreenDisplay } from "../src/player/display";
export interface RuntimeOptions {
  audioContext: () => AudioContext | null;
  graphics: () => WebGLRenderingContext | WebGL2RenderingContext;
  /** The display canvas for a WebGL context on a graphics worker (worker threads only). */
  offscreenGraphics?: () => OffscreenDisplay;
  log: (message: string) => void;
  report: (snapshot: unknown) => void;
  diagnostic: Diagnostic;
  mediaHost: HTMLElement;
  needsMovieResume?: (needed: boolean) => void;
  signal: AbortSignal;
}
export function runGuest(archive: IpaArchive, options: RuntimeOptions): Promise<unknown>;
