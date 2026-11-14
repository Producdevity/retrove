import { MatrixState, FIXED_TEXTURE_UNITS } from "./matrix-stack";
import { AlphaFunction, TextureFormat, TextureMode } from "./texture-environment";
import type { Vector4 } from "./matrix";
import type { FixedDrawState } from "./shader";
export interface ArrayPointer {
  size: number;
  type: number;
  stride: number;
  pointer: number;
  buffer: number;
}
const initialEnvironment: Vector4 = [0, 0, 0, 0];
export class FixedState {
  readonly matrices = new MatrixState();
  readonly arrays = new Map<number, ArrayPointer>();
  readonly enabledArrays = new Set<number>();
  readonly capabilities = new Set<number>();
  readonly textures = Array.from({ length: FIXED_TEXTURE_UNITS }, () => ({
    enabled: false,
    handle: 0,
    mode: Number(TextureMode.Modulate),
    color: initialEnvironment,
  }));
  color: Vector4 = [1, 1, 1, 1];
  normal: readonly [number, number, number] = [0, 0, 1];
  clientTexture = 0;
  alphaFunction: number = AlphaFunction.Always;
  alphaReference = 0;
  pointSize = 1;
  texture(unit = this.matrices.textureUnit) {
    const value = this.textures[unit];
    if (!value) throw new Error("Invalid ES 1 texture unit.");
    return value;
  }
  drawState(formats: ReadonlyMap<number, number>, alphaTest: number): FixedDrawState {
    const stage = (unit: number) => {
      const texture = this.texture(unit);
      return {
        ...texture,
        format: formats.get(texture.handle) ?? TextureFormat.RGBA,
        matrix: this.matrices.texture(unit).value,
      };
    };
    return {
      modelView: this.matrices.modelView.value,
      projection: this.matrices.projection.value,
      textures: [stage(0), stage(1)],
      alphaFunction: this.capabilities.has(alphaTest) ? this.alphaFunction : AlphaFunction.Always,
      alphaReference: this.alphaReference,
      pointSize: this.pointSize,
    };
  }
}
