export const TextureFormat = {
  Alpha: 0x1906,
  RGB: 0x1907,
  RGBA: 0x1908,
  Luminance: 0x1909,
  LuminanceAlpha: 0x190a,
} as const;
export const TextureMode = {
  Modulate: 0x2100,
  Decal: 0x2101,
  Replace: 0x1e01,
  Add: 0x0104,
  Blend: 0x0be2,
} as const;
export const AlphaFunction = {
  Never: 0x0200,
  Less: 0x0201,
  Equal: 0x0202,
  LessOrEqual: 0x0203,
  Greater: 0x0204,
  NotEqual: 0x0205,
  GreaterOrEqual: 0x0206,
  Always: 0x0207,
} as const;
export interface TextureStage {
  readonly enabled: boolean;
  readonly format: number;
  readonly mode: number;
  readonly color: readonly [number, number, number, number];
  readonly matrix: Float32Array;
}
export function textureExpression(stage: TextureStage, unit: number): string {
  const sample = `texture2DProj(uTexture${unit}, vTexture${unit})`;
  const hasColor = stage.format !== TextureFormat.Alpha;
  const hasAlpha =
    stage.format === TextureFormat.Alpha ||
    stage.format === TextureFormat.RGBA ||
    stage.format === TextureFormat.LuminanceAlpha;
  if (!Object.values(TextureFormat).some((format) => format === stage.format))
    throw new Error("Unsupported ES 1 texture base format.");
  let color: string,
    alpha = hasAlpha ? "color.a * texel.a" : "color.a";
  switch (stage.mode) {
    case TextureMode.Modulate:
      color = hasColor ? "color.rgb * texel.rgb" : "color.rgb";
      break;
    case TextureMode.Replace:
      color = hasColor ? "texel.rgb" : "color.rgb";
      alpha = hasAlpha ? "texel.a" : "color.a";
      break;
    case TextureMode.Add:
      color = hasColor ? "min(color.rgb + texel.rgb, vec3(1.0))" : "color.rgb";
      break;
    case TextureMode.Blend:
      color = hasColor ? `mix(color.rgb, uEnvironment${unit}.rgb, texel.rgb)` : "color.rgb";
      break;
    case TextureMode.Decal:
      if (stage.format !== TextureFormat.RGB && stage.format !== TextureFormat.RGBA)
        throw new Error("Undefined ES 1 decal texture format.");
      color = hasAlpha ? "mix(color.rgb, texel.rgb, texel.a)" : "texel.rgb";
      alpha = "color.a";
      break;
    default:
      throw new Error("Unsupported ES 1 texture environment mode.");
  }
  return `{ vec4 texel = ${sample}; color = vec4(${color}, ${alpha}); }`;
}
export function alphaRejection(comparison: number): string {
  switch (comparison) {
    case AlphaFunction.Never:
      return "true";
    case AlphaFunction.Less:
      return "color.a >= uAlphaReference";
    case AlphaFunction.Equal:
      return "color.a != uAlphaReference";
    case AlphaFunction.LessOrEqual:
      return "color.a > uAlphaReference";
    case AlphaFunction.Greater:
      return "color.a <= uAlphaReference";
    case AlphaFunction.NotEqual:
      return "color.a == uAlphaReference";
    case AlphaFunction.GreaterOrEqual:
      return "color.a < uAlphaReference";
    case AlphaFunction.Always:
      return "false";
    default:
      throw new Error("Invalid ES 1 alpha comparison.");
  }
}
