/** OpenGL ES 1.1 GL_COMBINE texture environment state and its fragment shader expression. */
export const COMBINE_MODE = 0x8570;
export const CombineFunction = {
  Replace: 0x1e01,
  Modulate: 0x2100,
  Add: 0x0104,
  AddSigned: 0x8574,
  Interpolate: 0x8575,
  Subtract: 0x84e7,
  Dot3RGB: 0x86ae,
  Dot3RGBA: 0x86af,
} as const;
export const CombineSource = {
  Texture: 0x1702,
  Constant: 0x8576,
  PrimaryColor: 0x8577,
  Previous: 0x8578,
} as const;
export const CombineOperand = {
  Color: 0x0300,
  OneMinusColor: 0x0301,
  Alpha: 0x0302,
  OneMinusAlpha: 0x0303,
} as const;
const Parameter = {
  CombineRGB: 0x8571,
  CombineAlpha: 0x8572,
  RGBScale: 0x8573,
  AlphaScale: 0x0d1c,
  SourceRGB: 0x8580,
  SourceAlpha: 0x8588,
  OperandRGB: 0x8590,
  OperandAlpha: 0x8598,
} as const;
const ARGUMENTS = 3;
/** GL_RGB_SCALE and GL_ALPHA_SCALE accept 1.0, 2.0 and 4.0 only. */
const Scale = { One: 1, Two: 2, Four: 4 } as const;
const SCALES = new Set<number>(Object.values(Scale));
type Triple = [number, number, number];
export interface Combine {
  rgb: number;
  alpha: number;
  rgbSources: Triple;
  alphaSources: Triple;
  rgbOperands: Triple;
  alphaOperands: Triple;
  rgbScale: number;
  alphaScale: number;
}

export function defaultCombine(): Combine {
  const { Texture, Previous, Constant } = CombineSource;
  return {
    rgb: CombineFunction.Modulate,
    alpha: CombineFunction.Modulate,
    rgbSources: [Texture, Previous, Constant],
    alphaSources: [Texture, Previous, Constant],
    rgbOperands: [CombineOperand.Color, CombineOperand.Color, CombineOperand.Alpha],
    alphaOperands: [CombineOperand.Alpha, CombineOperand.Alpha, CombineOperand.Alpha],
    rgbScale: 1,
    alphaScale: 1,
  };
}

const includes = (values: Record<string, number>, value: number) =>
  Object.values(values).includes(value);
const RGB_FUNCTIONS = CombineFunction;
const { Dot3RGB: _rgbOnly, Dot3RGBA: _rgbaOnly, ...ALPHA_FUNCTIONS } = CombineFunction;
const ALPHA_OPERANDS = { Alpha: CombineOperand.Alpha, OneMinusAlpha: CombineOperand.OneMinusAlpha };

/** Whether `name` is a GL_COMBINE parameter, and so belongs to the stage's combiner. */
export function isCombineParameter(name: number): boolean {
  return (
    name === Parameter.CombineRGB ||
    name === Parameter.CombineAlpha ||
    isScaleParameter(name) ||
    (name >= Parameter.SourceRGB && name < Parameter.SourceRGB + ARGUMENTS) ||
    (name >= Parameter.SourceAlpha && name < Parameter.SourceAlpha + ARGUMENTS) ||
    (name >= Parameter.OperandRGB && name < Parameter.OperandRGB + ARGUMENTS) ||
    (name >= Parameter.OperandAlpha && name < Parameter.OperandAlpha + ARGUMENTS)
  );
}
export function isScaleParameter(name: number): boolean {
  return name === Parameter.RGBScale || name === Parameter.AlphaScale;
}

/** Applies one glTexEnv combiner parameter; false means GL_INVALID_ENUM or GL_INVALID_VALUE. */
export function setCombine(combine: Combine, name: number, value: number): boolean {
  const slot = (base: number) => name - base;
  if (name === Parameter.CombineRGB && includes(RGB_FUNCTIONS, value)) combine.rgb = value;
  else if (name === Parameter.CombineAlpha && includes(ALPHA_FUNCTIONS, value))
    combine.alpha = value;
  else if (isScaleParameter(name) && SCALES.has(value)) {
    if (name === Parameter.RGBScale) combine.rgbScale = value;
    else combine.alphaScale = value;
  } else if (slot(Parameter.SourceRGB) in combine.rgbSources && includes(CombineSource, value))
    combine.rgbSources[slot(Parameter.SourceRGB)] = value;
  else if (slot(Parameter.SourceAlpha) in combine.alphaSources && includes(CombineSource, value))
    combine.alphaSources[slot(Parameter.SourceAlpha)] = value;
  else if (slot(Parameter.OperandRGB) in combine.rgbOperands && includes(CombineOperand, value))
    combine.rgbOperands[slot(Parameter.OperandRGB)] = value;
  else if (slot(Parameter.OperandAlpha) in combine.alphaOperands && includes(ALPHA_OPERANDS, value))
    combine.alphaOperands[slot(Parameter.OperandAlpha)] = value;
  else return false;
  return true;
}

function source(value: number, unit: number): string {
  switch (value) {
    case CombineSource.Texture:
      return "texel";
    case CombineSource.Constant:
      return `uEnvironment${unit}`;
    case CombineSource.PrimaryColor:
      return "clamp(vColor, 0.0, 1.0)";
    default:
      return "color";
  }
}
function rgbArgument(combine: Combine, index: number, unit: number): string {
  const value = source(combine.rgbSources[index] ?? CombineSource.Previous, unit);
  switch (combine.rgbOperands[index]) {
    case CombineOperand.OneMinusColor:
      return `(vec3(1.0) - ${value}.rgb)`;
    case CombineOperand.Alpha:
      return `vec3(${value}.a)`;
    case CombineOperand.OneMinusAlpha:
      return `vec3(1.0 - ${value}.a)`;
    default:
      return `${value}.rgb`;
  }
}
function alphaArgument(combine: Combine, index: number, unit: number): string {
  const value = source(combine.alphaSources[index] ?? CombineSource.Previous, unit);
  return combine.alphaOperands[index] === CombineOperand.OneMinusAlpha
    ? `(1.0 - ${value}.a)`
    : `${value}.a`;
}
function apply(operation: number, [a0, a1, a2]: readonly string[], one: string): string {
  switch (operation) {
    case CombineFunction.Replace:
      return `${a0}`;
    case CombineFunction.Add:
      return `(${a0} + ${a1})`;
    case CombineFunction.AddSigned:
      return `(${a0} + ${a1} - ${one} * 0.5)`;
    case CombineFunction.Interpolate:
      return `mix(${a1}, ${a0}, ${a2})`;
    case CombineFunction.Subtract:
      return `(${a0} - ${a1})`;
    case CombineFunction.Dot3RGB:
    case CombineFunction.Dot3RGBA:
      return `${one} * (4.0 * dot(${a0} - vec3(0.5), ${a1} - vec3(0.5)))`;
    default:
      return `(${a0} * ${a1})`;
  }
}

/** GLSL that replaces `color` with the combiner output, given `texel` for this stage. */
export function combineExpression(combine: Combine, unit: number): string {
  const indexes = Array.from({ length: ARGUMENTS }, (_, index) => index);
  const rgb = apply(
    combine.rgb,
    indexes.map((index) => rgbArgument(combine, index, unit)),
    "vec3(1.0)",
  );
  const dot3Alpha = combine.rgb === CombineFunction.Dot3RGBA;
  const alpha = dot3Alpha
    ? `(${rgb}).r`
    : apply(
        combine.alpha,
        indexes.map((index) => alphaArgument(combine, index, unit)),
        "1.0",
      );
  // DOT3_RGBA writes the dot product to alpha too, scaled like the colour.
  const alphaScale = dot3Alpha ? combine.rgbScale : combine.alphaScale;
  return `color = clamp(vec4((${rgb}) * ${combine.rgbScale.toFixed(1)}, (${alpha}) * ${alphaScale.toFixed(1)}), 0.0, 1.0);`;
}
