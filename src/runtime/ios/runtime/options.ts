import type { OffscreenDisplay } from "../../../player/display";
import type { GraphicsContext } from "../../graphics/gl-parameters";
import type { Diagnostic } from "../package/ipa";

export interface RuntimeOptions {
  readonly audioContext?: () => AudioContext | null;
  readonly graphics?: () => GraphicsContext;
  /** The display canvas for a WebGL context on a graphics worker (worker threads only). */
  readonly offscreenGraphics?: () => OffscreenDisplay;
  readonly log?: (message: string) => void;
  readonly report?: (snapshot: unknown) => void;
  readonly diagnostic?: Diagnostic;
  readonly mediaHost?: HTMLElement;
  readonly needsMovieResume?: (needed: boolean) => void;
  readonly signal?: AbortSignal;
}
type Defaulted = "audioContext" | "graphics" | "log" | "report" | "diagnostic";
export type ResolvedOptions = Required<Pick<RuntimeOptions, Defaulted>> &
  Omit<RuntimeOptions, Defaulted>;

export function resolveOptions(options: RuntimeOptions): ResolvedOptions {
  const log = options.log ?? (() => {});
  return {
    ...options,
    audioContext: options.audioContext ?? (() => null),
    graphics:
      options.graphics ??
      (() => {
        throw Error("WebGL unavailable");
      }),
    log,
    report: options.report ?? (() => {}),
    diagnostic: options.diagnostic ?? ((_level, _area, message) => log(message)),
  };
}
