import { alphaRejection, textureExpression, type TextureStage } from "./texture-environment";
import { COMBINE_MODE } from "./texture-combine";
/** Attribute slots: texture units follow colour, then the normal, then OES point sizes. */
export const Attribute = { Position: 0, Color: 1, TextureStart: 2, PointSize: 5 } as const;
export interface FixedDrawState {
  readonly modelView: Float32Array;
  readonly projection: Float32Array;
  readonly textures: readonly [TextureStage, TextureStage];
  readonly alphaFunction: number;
  readonly alphaReference: number;
  readonly pointSize: number;
  /** Per-vertex sizes from glPointSizePointerOES instead of glPointSize. */
  readonly pointSizeArray: boolean;
  /** Points drawn with GL_POINT_SPRITE_OES enabled. */
  readonly pointSprite: boolean;
}
/** Whether a stage samples at gl_PointCoord instead of its texture coordinates. */
function replacesCoordinates(state: FixedDrawState, stage: TextureStage): boolean {
  return state.pointSprite && stage.coordReplace;
}
export function programKey(state: FixedDrawState): string {
  return JSON.stringify([
    state.alphaFunction,
    state.pointSizeArray,
    ...state.textures.map((stage) =>
      stage.enabled
        ? [
            stage.mode,
            stage.format,
            stage.mode === COMBINE_MODE ? stage.combine : 0,
            replacesCoordinates(state, stage),
          ]
        : false,
    ),
  ]);
}
export function shaderSource(state: FixedDrawState): { vertex: string; fragment: string } {
  const active = state.textures.flatMap((stage, unit) => (stage.enabled ? [{ stage, unit }] : []));
  const varying = active.map(({ unit }) => `varying vec4 vTexture${unit};`).join("\n");
  const vertex = `
attribute vec4 aPosition;
attribute vec4 aColor;
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform float uPointSize;
${state.pointSizeArray ? "attribute float aPointSize;" : ""}
varying vec4 vColor;
${varying}
${active.map(({ unit }) => `attribute vec4 aTexture${unit}; uniform mat4 uTextureMatrix${unit};`).join("\n")}
void main() {
 gl_Position = uProjection * uModelView * aPosition;
 gl_PointSize = ${state.pointSizeArray ? "aPointSize" : "uPointSize"};
 vColor = clamp(aColor, 0.0, 1.0);
 ${active.map(({ unit }) => `vTexture${unit} = uTextureMatrix${unit} * aTexture${unit};`).join("\n")}
}`;
  const fragment = `
precision mediump float;
varying vec4 vColor;
uniform float uAlphaReference;
${varying}
${active.map(({ unit }) => `uniform sampler2D uTexture${unit}; uniform vec4 uEnvironment${unit};`).join("\n")}
void main() {
 vec4 color = clamp(vColor, 0.0, 1.0);
 ${active
   .map(({ stage, unit }) => textureExpression(stage, unit, replacesCoordinates(state, stage)))
   .join("\n")}
 if (${alphaRejection(state.alphaFunction)}) discard;
 gl_FragColor = color;
}`;
  return { vertex, fragment };
}
