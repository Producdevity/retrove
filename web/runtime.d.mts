import type { Diagnostic, IpaArchive } from "./ipa.mjs";
export interface RuntimeOptions {
  audioContext: () => AudioContext | null;
  graphics: () => WebGLRenderingContext | WebGL2RenderingContext;
  log: (message: string) => void;
  report: (snapshot: unknown) => void;
  diagnostic: Diagnostic;
  mediaHost: HTMLElement;
  needsMovieResume?: (needed: boolean) => void;
  signal: AbortSignal;
}
export function runGuest(archive: IpaArchive, options: RuntimeOptions): Promise<unknown>;
