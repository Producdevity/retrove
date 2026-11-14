import { floatFromBits } from "../../ios/abi/scalars";
import { GraphicsBridge, GL, type FixedHost } from "./host";
import { FixedPrograms } from "./program";
import { FixedState } from "./state";
import { installMatrices } from "./matrix-bindings";
import { installArrays, prepareArrays } from "./array-bindings";
import { installTextures } from "./texture-bindings";
import { installQueries } from "./queries";
import { AlphaFunction } from "./texture-environment";
const HEX_RADIX = 16;
const DrawArguments = { DrawArrays: 3, DrawElements: 4 } as const;
const FIXED_CAPABILITIES: ReadonlySet<number> = new Set([
  GL.AlphaTest,
  GL.Lighting,
  GL.Fog,
  GL.Normalize,
  GL.RescaleNormal,
  GL.ColorMaterial,
]);
const GL_ARGUMENTS = { Comparison: 0, Reference: 1 } as const;
const OES_ALIASES = [
  "BindFramebuffer",
  "BindRenderbuffer",
  "CheckFramebufferStatus",
  "DeleteFramebuffers",
  "DeleteRenderbuffers",
  "FramebufferRenderbuffer",
  "FramebufferTexture2D",
  "GenFramebuffers",
  "GenRenderbuffers",
  "GetFramebufferAttachmentParameteriv",
  "GetRenderbufferParameteriv",
  "IsFramebuffer",
  "IsRenderbuffer",
  "RenderbufferStorage",
  "GenerateMipmap",
] as const;
export function installFixedFunction(host: FixedHost): () => void {
  const bridge = new GraphicsBridge(host),
    states = new Map<number, FixedState>(),
    formats = new Map<number, number>();
  let programs: FixedPrograms | undefined;
  const current = (): FixedState => {
    const id = host.currentContext();
    let state = states.get(id);
    if (!state) {
      state = new FixedState();
      states.set(id, state);
    }
    return state;
  };
  installMatrices(bridge, current);
  installArrays(bridge, current);
  installTextures(bridge, current, formats);
  installQueries(bridge, current);
  for (const [name, enabled] of [
    ["Enable", true],
    ["Disable", false],
  ] as const)
    bridge.register(name, (args) => {
      const state = current(),
        cap = args(0);
      if (cap === GL.Texture2D) {
        state.texture().enabled = enabled;
        return undefined;
      }
      if (FIXED_CAPABILITIES.has(cap)) {
        if (enabled && (cap === GL.Lighting || cap === GL.Fog))
          throw new Error(`Unsupported ES 1 rendering capability 0x${cap.toString(HEX_RADIX)}.`);
        if (enabled) state.capabilities.add(cap);
        else state.capabilities.delete(cap);
        return undefined;
      }
      return bridge.call(name, [cap]);
    });
  bridge.register("IsEnabled", (args) => {
    const state = current(),
      cap = args(0);
    if (cap === GL.Texture2D) return Number(state.texture().enabled);
    if (FIXED_CAPABILITIES.has(cap)) return Number(state.capabilities.has(cap));
    return bridge.call("IsEnabled", [cap]);
  });
  bridge.register("AlphaFunc", (args) => {
    const comparison = args(GL_ARGUMENTS.Comparison);
    if (!Object.values(AlphaFunction).some((value) => value === comparison)) {
      host.error(GL.InvalidEnum);
      return;
    }
    current().alphaFunction = comparison;
    current().alphaReference = Math.max(
      0,
      Math.min(1, floatFromBits(args(GL_ARGUMENTS.Reference))),
    );
  });
  for (const name of ["DrawArrays", "DrawElements"] as const)
    bridge.register(name, (args) => {
      const state = current();
      if (!prepareArrays(bridge, state)) return undefined;
      programs ??= new FixedPrograms(host.gl());
      programs.apply(state.drawState(formats, GL.AlphaTest));
      return bridge.call(
        name,
        Array.from({ length: DrawArguments[name] }, (_, index) => args(index)),
      );
    });
  for (const name of OES_ALIASES) host.api[`_gl${name}OES`] = host.api[`_gl${name}`];
  return () => {
    programs?.close();
    states.clear();
    formats.clear();
  };
}
