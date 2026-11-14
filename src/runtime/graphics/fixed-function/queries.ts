import { floatBits, WORD_BYTES } from "../../ios/abi/scalars";
import { GL, FIXED_SCALE, type GraphicsBridge } from "./host";
import {
  MatrixMode,
  FIXED_TEXTURE_UNITS,
  MODEL_VIEW_STACK_DEPTH,
  PROJECTION_STACK_DEPTH,
  TEXTURE_STACK_DEPTH,
} from "./matrix-stack";
import type { FixedState } from "./state";
const Parameter = {
  MatrixMode: 0x0ba0,
  ModelView: 0x0ba6,
  Projection: 0x0ba7,
  Texture: 0x0ba8,
  ModelViewDepth: 0x0ba3,
  ProjectionDepth: 0x0ba4,
  TextureDepth: 0x0ba5,
  MaxModelViewDepth: 0x0d36,
  MaxProjectionDepth: 0x0d38,
  MaxTextureDepth: 0x0d39,
  MaxTextureUnits: 0x84e2,
  CurrentColor: 0x0b00,
  CurrentNormal: 0x0b02,
  PointSize: 0x0b11,
  ShadeModel: 0x0b54,
  AlphaFunction: 0x0bc1,
  AlphaReference: 0x0bc2,
  ClientActiveTexture: 0x84e1,
} as const;
export function fixedParameter(
  state: FixedState,
  name: number,
): number | Float32Array | readonly number[] | undefined {
  switch (name) {
    case Parameter.MatrixMode:
      return state.matrices.mode;
    case Parameter.ModelView:
      return state.matrices.modelView.value;
    case Parameter.Projection:
      return state.matrices.projection.value;
    case Parameter.Texture:
      return state.matrices.texture(state.matrices.textureUnit).value;
    case Parameter.ModelViewDepth:
      return state.matrices.modelView.depth;
    case Parameter.ProjectionDepth:
      return state.matrices.projection.depth;
    case Parameter.TextureDepth:
      return state.matrices.texture(state.matrices.textureUnit).depth;
    case Parameter.MaxModelViewDepth:
      return MODEL_VIEW_STACK_DEPTH;
    case Parameter.MaxProjectionDepth:
      return PROJECTION_STACK_DEPTH;
    case Parameter.MaxTextureDepth:
      return TEXTURE_STACK_DEPTH;
    case Parameter.MaxTextureUnits:
      return FIXED_TEXTURE_UNITS;
    case Parameter.CurrentColor:
      return state.color;
    case Parameter.CurrentNormal:
      return state.normal;
    case Parameter.PointSize:
      return state.pointSize;
    case Parameter.ShadeModel:
      return GL.Smooth;
    case Parameter.AlphaFunction:
      return state.alphaFunction;
    case Parameter.AlphaReference:
      return state.alphaReference;
    case Parameter.ClientActiveTexture:
      return GL.Texture0 + state.clientTexture;
  }
  if (Object.values(MatrixMode).some((mode) => mode === name)) return undefined;
  return undefined;
}
export function installQueries(bridge: GraphicsBridge, current: () => FixedState): void {
  for (const [name, format] of [
    ["GetFloatv", "float"],
    ["GetIntegerv", "integer"],
    ["GetBooleanv", "boolean"],
    ["GetFixedv", "fixed"],
  ] as const)
    bridge.register(name, (args) => {
      const value = fixedParameter(current(), args(0));
      if (value === undefined) return bridge.call(name, [args(0), args(1)]);
      const values = typeof value === "number" ? [value] : value;
      const width = format === "boolean" ? 1 : WORD_BYTES,
        bytes = new Uint8Array(values.length * width),
        view = new DataView(bytes.buffer);
      for (const [index, item] of values.entries()) {
        if (format === "boolean") view.setUint8(index, Number(item !== 0));
        else
          view.setUint32(
            index * WORD_BYTES,
            format === "float"
              ? floatBits(item)
              : format === "fixed"
                ? Math.round(item * FIXED_SCALE)
                : Math.round(item),
            true,
          );
      }
      bridge.host.write(args(1), bytes);
      return undefined;
    });
  let version = 0;
  bridge.register("GetString", (args) => {
    if (args(0) === GL.Version) return (version ||= bridge.host.string("OpenGL ES-CM 1.1 Retrove"));
    return bridge.call("GetString", [args(0)]);
  });
}
