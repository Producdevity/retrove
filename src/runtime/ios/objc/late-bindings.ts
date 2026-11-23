import type { TouchUIKit } from "../uikit/touch/touch";
import type { CoreFoundation } from "../foundation/corefoundation";
import type { foundation } from "../foundation/foundation";
import type { FileObjects } from "../foundation/foundation-files";
import type { RunLoopSources } from "../foundation/run-loop-sources";
import type { RunLoop } from "../foundation/runloop";
import type { moviePlayers } from "../media/movie";
import type { NibLoader } from "../uikit/nib/instantiate";
import type { DispatchService } from "./runtime-types";
import { initialized } from "./runtime-types";

export type FoundationObjects = ReturnType<typeof foundation>;
export type FoundationRunLoop = RunLoop;
export type MoviePlayers = ReturnType<typeof moviePlayers>;
/** Services created after the methods that call them, filled in as the runtime is assembled. */
export interface LateBindings {
  foundation?: FoundationObjects;
  input?: TouchUIKit;
  nibs?: NibLoader;
  files?: FileObjects;
  scheduler?: FoundationRunLoop;
  runLoopSources?: RunLoopSources;
  coreFoundation?: CoreFoundation;
  dispatch?: DispatchService;
  movies?: MoviePlayers;
}
export interface LateServices {
  readonly bindings: LateBindings;
  readonly foundation: () => FoundationObjects;
  readonly input: () => TouchUIKit;
  readonly nibs: () => NibLoader;
  readonly files: () => FileObjects;
  readonly scheduler: () => FoundationRunLoop;
  readonly dispatch: () => DispatchService;
  readonly movies: () => MoviePlayers;
}
export function lateServices(): LateServices {
  const bindings: LateBindings = {};
  return {
    bindings,
    foundation: () => initialized(bindings.foundation, "foundationObjects"),
    input: () => initialized(bindings.input, "input"),
    nibs: () => initialized(bindings.nibs, "nibs"),
    files: () => initialized(bindings.files, "fileObjects"),
    scheduler: () => initialized(bindings.scheduler, "scheduler"),
    dispatch: () => initialized(bindings.dispatch, "dispatchService"),
    movies: () => initialized(bindings.movies, "movies"),
  };
}
