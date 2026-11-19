import { floatFromBits, WORD_BYTES } from "../../ios/abi/scalars";
import { Component, FIXED_SCALE, GL, type GraphicsBridge } from "./host";
import type { Vector4 } from "./matrix";

export const FogMode = { Linear: 0x2601, Exponential: 0x0800, ExponentialSquared: 0x0801 } as const;
const FogParameter = {
  Density: 0x0b62,
  Start: 0x0b63,
  End: 0x0b64,
  Mode: 0x0b65,
  Color: 0x0b66,
} as const;
const COLOR_COMPONENTS = 4;
const MODES: ReadonlySet<number> = new Set(Object.values(FogMode));

/** ES 1.1 fog state with its specified initial values. */
export class Fog {
  mode: number = FogMode.Exponential;
  density = 1;
  start = 0;
  end = 1;
  color: Vector4 = [0, 0, 0, 0];
}
/** The fog a draw uses: its mode, or 0 when GL_FOG is disabled. */
export interface FogDraw {
  readonly mode: number;
  readonly density: number;
  readonly start: number;
  readonly end: number;
  readonly color: Vector4;
}

function setScalar(bridge: GraphicsBridge, fog: Fog, name: number, value: number, mode: number) {
  switch (name) {
    case FogParameter.Mode:
      if (MODES.has(mode)) fog.mode = mode;
      else bridge.host.error(GL.InvalidEnum);
      return;
    case FogParameter.Density:
      if (value < 0) bridge.host.error(GL.InvalidValue);
      else fog.density = value;
      return;
    case FogParameter.Start:
      fog.start = value;
      return;
    case FogParameter.End:
      fog.end = value;
      return;
    default:
      bridge.host.error(GL.InvalidEnum);
  }
}

/** glFog{f,x}[v]. The mode is an enum in every variant; other values are float or 16.16 fixed. */
export function installFog(bridge: GraphicsBridge, current: () => Fog): void {
  for (const [suffix, number] of [
    ["f", floatFromBits],
    ["x", (bits: number) => (bits | 0) / FIXED_SCALE],
  ] as const) {
    const mode = (bits: number) => (suffix === "f" ? Math.trunc(floatFromBits(bits)) : bits);
    bridge.register("Fog" + suffix, (args) => {
      const bits = args(1);
      setScalar(bridge, current(), args(0), number(bits), mode(bits));
    });
    bridge.register(`Fog${suffix}v`, (args) => {
      const name = args(0),
        color = name === FogParameter.Color;
      const bytes = bridge.host.read(args(1), WORD_BYTES * (color ? COLOR_COMPONENTS : 1));
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const word = (index: number) => view.getUint32(index * WORD_BYTES, true);
      if (!color) {
        setScalar(bridge, current(), name, number(word(0)), mode(word(0)));
        return;
      }
      const channel = (index: number) => Math.max(0, Math.min(1, number(word(index))));
      current().color = [
        channel(Component.X),
        channel(Component.Y),
        channel(Component.Z),
        channel(Component.W),
      ];
    });
  }
}

/** The fog factor f of ES 1.1 section 3.8, from the eye-space depth approximation |z|. */
function fogFactor(mode: number): string {
  switch (mode) {
    case FogMode.Linear:
      return "(uFog.z - vFogDepth) / (uFog.z - uFog.y)";
    case FogMode.Exponential:
      return "exp(-uFog.x * vFogDepth)";
    default:
      return "exp(-(uFog.x * vFogDepth) * (uFog.x * vFogDepth))";
  }
}
export function fogShader(mode: number): {
  vertex: string;
  fragment: string;
  declarations: string;
} {
  if (!mode) return { vertex: "", fragment: "", declarations: "" };
  return {
    declarations: "varying float vFogDepth;",
    vertex: "vFogDepth = abs((uModelView * aPosition).z);",
    fragment: `uniform vec4 uFog; uniform vec4 uFogColor;
float fogFactor() { return clamp(${fogFactor(mode)}, 0.0, 1.0); }`,
  };
}
