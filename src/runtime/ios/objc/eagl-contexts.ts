import { RenderingAPI } from "../../graphics/fixed-function/host";
import type { PresentPacing } from "../../graphics/present-pacing";
import type { ObjcCore } from "./core";
import { isKind } from "./core";
import type { Drawable } from "../../graphics/drawable";
import { pointerResult } from "./runtime-types";

const CONTEXT = "EAGLContext";
const COLOR_FORMAT_KEY = "EAGLDrawablePropertyColorFormat";
const DEFAULT_COLOR_FORMAT = "RGBA8";
export interface EAGLContexts {
  /** The current context of the calling guest thread, or 0. */
  readonly currentContext: () => number;
  readonly graphicsAPI: () => number;
  readonly clearContext: (thread: number) => Promise<void>;
}
interface EAGLHost {
  readonly drawable: Drawable;
  readonly pacing: PresentPacing;
  readonly graphics: () => unknown;
  readonly onPresent: (presented: number, duration: number) => void;
}
/** Renderbuffer storage from a CAEAGLLayer and presentation paced to the display. */
function installDrawableMethods(
  core: ObjcCore,
  host: EAGLHost,
  currentContext: () => number,
): void {
  const { messenger, strings } = core;
  const { method } = core.registry;
  const { drawable, pacing } = host;
  method(CONTEXT, false, "renderbufferStorage:fromDrawable:", async (self, args) => {
    if (currentContext() !== self || !args(1) || !isKind(core, args(1), "CAEAGLLayer")) return 0;
    const target = args(0),
      layer = args(1),
      properties = pointerResult(await messenger.send(layer, "drawableProperties"));
    const format = properties
      ? pointerResult(
          await messenger.send(properties, "objectForKey:", [strings.string(COLOR_FORMAT_KEY)]),
        )
      : 0;
    return drawable.allocate(target, layer, format ? strings.text(format) : DEFAULT_COLOR_FORMAT);
  });
  const present = (self: number, target: number): number => {
    const started = performance.now();
    let result = 0;
    try {
      if (currentContext() === self) result = drawable.present(target);
      return result;
    } finally {
      host.onPresent(result, performance.now() - started);
    }
  };
  // A second present within one display refresh waits for the next one, as on iOS; other guest
  // threads keep running meanwhile.
  method(CONTEXT, false, "presentRenderbuffer:", (self, args) => {
    const target = args(0);
    if (pacing.take(performance.now())) return present(self, target);
    return { wait: () => (pacing.take(performance.now()) ? present(self, target) : undefined) };
  });
}
/** EAGLContext: per-thread current contexts, sharegroups and paced presentation. */
export function installEAGLContexts(core: ObjcCore, host: EAGLHost): EAGLContexts {
  const { registry, ownership, messenger } = core;
  const { method } = registry;
  const currentContexts = new Map<number, number>(),
    contexts = new Map<number, number>(),
    contextAPIs = new Map<number, number>();
  const currentContext = () => currentContexts.get(ownership.threadId()) ?? 0;
  async function clearContext(thread: number): Promise<void> {
    const context = currentContexts.get(thread);
    if (context) {
      currentContexts.delete(thread);
      await ownership.releaseFromHost(context);
    }
  }
  core.guest.threads?.onExit?.((thread) => {
    messenger.forgetThread(thread);
    return clearContext(thread);
  });
  installDrawableMethods(core, host, currentContext);
  const initContext = (self: number, api: number, sharegroup: number): number => {
    if (api !== RenderingAPI.OpenGLES1 && api !== RenderingAPI.OpenGLES2)
      throw new Error("Unsupported EAGL rendering API");
    contextAPIs.set(self, api);
    host.graphics();
    contexts.set(
      self,
      ownership.retain(sharegroup) || ownership.alloc(registry.names.get("EAGLSharegroup") ?? 0),
    );
    return self;
  };
  method(CONTEXT, false, "initWithAPI:", (self, args) => initContext(self, args(0), 0));
  method(CONTEXT, false, "initWithAPI:sharegroup:", (self, args) =>
    initContext(self, args(0), args(1)),
  );
  method(CONTEXT, false, "sharegroup", (self) => contexts.get(self) ?? 0);
  method(CONTEXT, false, "API", (self) => contextAPIs.get(self) ?? 0);
  method(CONTEXT, false, "dealloc", async (self) => {
    await ownership.releaseFromHost(contexts.get(self) ?? 0);
    contexts.delete(self);
    contextAPIs.delete(self);
    ownership.destroy(self);
  });
  method(CONTEXT, true, "setCurrentContext:", async (_, args) => {
    const context = args(0),
      thread = ownership.threadId();
    if (context && !contexts.has(context)) return 0;
    if (currentContext() === context) return 1;
    ownership.retain(context);
    await clearContext(thread);
    if (context) currentContexts.set(thread, context);
    return 1;
  });
  method(CONTEXT, true, "currentContext", currentContext);
  return {
    currentContext,
    graphicsAPI: () => contextAPIs.get(currentContext()) ?? RenderingAPI.OpenGLES2,
    clearContext,
  };
}
