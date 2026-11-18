import { floatFromBits, WORD_BYTES } from "../../ios/abi/scalars";
import { FIXED_TEXTURE_UNITS } from "./matrix-stack";
import { Component, GL, type GraphicsBridge } from "./host";
import { TextureFormat, TextureMode } from "./texture-environment";
import { COMBINE_MODE, isCombineParameter, isScaleParameter, setCombine } from "./texture-combine";
import type { FixedState } from "./state";
const COLOR_COMPONENTS = 4;
/** GLfixed is 16.16. */
const FIXED_ONE = 0x10000;
const INT_COLOR_MAX = 0x7fffffff;
const TEXTURE_UPLOAD_ARGUMENTS = 9;
const COMPRESSED_UPLOAD_ARGUMENTS = 8;
const UploadArgument = { Format: 2, Level: 1 } as const;
const PVRTC = { RGB2: 0x8c01, RGB4: 0x8c00, RGBA2: 0x8c03, RGBA4: 0x8c02 } as const;
export function installTextures(
  bridge: GraphicsBridge,
  current: () => FixedState,
  formats: Map<number, number>,
): void {
  const select = (value: number): number | undefined => {
    const unit = value - GL.Texture0;
    if (unit < 0 || unit >= FIXED_TEXTURE_UNITS) {
      bridge.host.error(GL.InvalidEnum);
      return undefined;
    }
    return unit;
  };
  bridge.register("ClientActiveTexture", (args) => {
    const unit = select(args(0));
    if (unit !== undefined) current().clientTexture = unit;
  });
  bridge.register("ActiveTexture", (args) => {
    const unit = select(args(0));
    if (unit === undefined) return undefined;
    current().matrices.textureUnit = unit;
    return bridge.call("ActiveTexture", [args(0)]);
  });
  bridge.register("BindTexture", (args) => {
    if (args(0) === GL.Texture2D) current().texture().handle = args(1);
    return bridge.call("BindTexture", [args(0), args(1)]);
  });
  for (const [name, count] of [
    ["TexImage2D", TEXTURE_UPLOAD_ARGUMENTS],
    ["CompressedTexImage2D", COMPRESSED_UPLOAD_ARGUMENTS],
  ] as const)
    bridge.register(name, (args) => {
      const format = args(UploadArgument.Format);
      if (args(0) === GL.Texture2D && args(UploadArgument.Level) === 0)
        formats.set(
          current().texture().handle,
          format === PVRTC.RGB2 || format === PVRTC.RGB4
            ? TextureFormat.RGB
            : format === PVRTC.RGBA2 || format === PVRTC.RGBA4
              ? TextureFormat.RGBA
              : format,
        );
      return bridge.call(
        name,
        Array.from({ length: count }, (_, index) => args(index)),
      );
    });
  installEnvironment(bridge, current);
}
/** How a glTexEnv variant passes values: enums as integers, scales and colours as numbers. */
interface ValueDecoding {
  readonly enumeration: (bits: number) => number;
  readonly number: (bits: number) => number;
}
const DECODINGS: Readonly<Record<"i" | "x" | "f", ValueDecoding>> = {
  i: { enumeration: (bits) => bits, number: (bits) => bits | 0 },
  x: { enumeration: (bits) => bits, number: (bits) => (bits | 0) / FIXED_ONE },
  f: { enumeration: (bits) => Math.trunc(floatFromBits(bits)), number: floatFromBits },
};
const MODES = new Set<number>([...Object.values(TextureMode), COMBINE_MODE]);

/** Applies one scalar glTexEnv parameter, reporting GL errors as the iOS driver does. */
function setEnvironment(
  bridge: GraphicsBridge,
  state: FixedState,
  name: number,
  bits: number,
  decoding: ValueDecoding,
): void {
  const stage = state.texture();
  if (name === GL.EnvironmentMode) {
    const mode = decoding.enumeration(bits);
    if (MODES.has(mode)) stage.mode = mode;
    else bridge.host.error(GL.InvalidEnum);
    return;
  }
  if (!isCombineParameter(name)) {
    bridge.host.error(GL.InvalidEnum);
    return;
  }
  const scale = isScaleParameter(name);
  const value = scale ? decoding.number(bits) : decoding.enumeration(bits);
  if (!setCombine(stage.combine, name, value))
    bridge.host.error(scale ? GL.InvalidValue : GL.InvalidEnum);
}

function installEnvironment(bridge: GraphicsBridge, current: () => FixedState): void {
  for (const [suffix, decoding] of Object.entries(DECODINGS)) {
    const scalar = (target: number, name: number, bits: number) => {
      const state = current();
      if (target === GL.TextureEnvironment) setEnvironment(bridge, state, name, bits, decoding);
      else if (target === GL.PointSprite && name === GL.CoordReplace)
        state.texture().coordReplace = decoding.number(bits) !== 0;
      else bridge.host.error(GL.InvalidEnum);
    };
    bridge.register("TexEnv" + suffix, (args) => scalar(args(0), args(1), args(Component.Z)));
    bridge.register(`TexEnv${suffix}v`, (args) => {
      const color = args(0) === GL.TextureEnvironment && args(1) === GL.EnvironmentColor;
      const bytes = bridge.host.read(
        args(Component.Z),
        WORD_BYTES * (color ? COLOR_COMPONENTS : 1),
      );
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const word = (index: number) => view.getUint32(index * WORD_BYTES, true);
      if (!color) {
        scalar(args(0), args(1), word(0));
        return;
      }
      // Integer colours map the full signed range to [-1, 1] before clamping.
      const channel = (index: number) =>
        suffix === "i" ? (word(index) | 0) / INT_COLOR_MAX : decoding.number(word(index));
      const read = (index: number) => Math.max(0, Math.min(1, channel(index)));
      current().texture().color = [
        read(Component.X),
        read(Component.Y),
        read(Component.Z),
        read(Component.W),
      ];
    });
  }
}
