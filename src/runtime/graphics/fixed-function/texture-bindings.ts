import { floatFromBits, WORD_BYTES } from "../../ios/abi/scalars";
import { FIXED_TEXTURE_UNITS } from "./matrix-stack";
import { Component, GL, type GraphicsBridge } from "./host";
import { TextureFormat, TextureMode } from "./texture-environment";
import type { FixedState } from "./state";
const HEX_RADIX = 16;
const COLOR_COMPONENTS = 4;
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
function installEnvironment(bridge: GraphicsBridge, current: () => FixedState): void {
  for (const [suffix, decode] of [
    ["i", (value: number) => value],
    ["x", (value: number) => value],
    ["f", floatFromBits],
  ] as const)
    bridge.register("TexEnv" + suffix, (args) => {
      if (args(0) !== GL.TextureEnvironment || args(1) !== GL.EnvironmentMode) {
        bridge.host.error(GL.InvalidEnum);
        return;
      }
      const mode = decode(args(Component.Z));
      if (!Object.values(TextureMode).some((value) => value === mode))
        throw new Error(`Unsupported ES 1 texture environment mode 0x${mode.toString(HEX_RADIX)}.`);
      current().texture().mode = mode;
    });
  bridge.register("TexEnvfv", (args) => {
    if (args(0) !== GL.TextureEnvironment) {
      bridge.host.error(GL.InvalidEnum);
      return;
    }
    if (args(1) !== GL.EnvironmentColor && args(1) !== GL.EnvironmentMode) {
      bridge.host.error(GL.InvalidEnum);
      return;
    }
    const bytes = bridge.host.read(
      args(Component.Z),
      WORD_BYTES * (args(1) === GL.EnvironmentColor ? COLOR_COMPONENTS : 1),
    );
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (args(1) === GL.EnvironmentMode) {
      bridge.host.api._glTexEnvf?.((index) =>
        index === Component.Z ? view.getUint32(0, true) : args(index),
      );
      return;
    }
    if (args(1) !== GL.EnvironmentColor) {
      bridge.host.error(GL.InvalidEnum);
      return;
    }
    const read = (index: number) =>
      Math.max(0, Math.min(1, view.getFloat32(index * WORD_BYTES, true)));
    current().texture().color = [
      read(Component.X),
      read(Component.Y),
      read(Component.Z),
      read(Component.W),
    ];
  });
}
