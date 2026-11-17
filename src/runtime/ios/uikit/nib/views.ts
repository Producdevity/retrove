import { GeometryField, WORD_BYTES } from "../../abi/scalars";
import { objectResult, type Rectangle } from "../host";
import { installNibControls, type NibControlHost } from "./controls";
const FLOAT_VECTOR = 6;
const RECT_COMPONENTS = 4;
const POINT_COMPONENTS = 2;
export interface NibViewHost extends NibControlHost {
  bytes(pointer: number): Uint8Array;
  isString(pointer: number): boolean;
  items(pointer: number): number[];
}
async function decoded(host: NibViewHost, coder: number, key: string): Promise<number> {
  return objectResult(await host.send(coder, "decodeObjectForKey:", [host.string(key)]));
}
function component(bytes: Uint8Array, count: number, index: number): number {
  if (bytes.length !== 1 + count * WORD_BYTES || bytes[0] !== FLOAT_VECTOR)
    throw new Error("Unsupported nib geometry encoding.");
  const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(
    1 + index * WORD_BYTES,
    true,
  );
  if (!Number.isFinite(value)) throw new Error("Invalid nib geometry coordinate.");
  return value;
}
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
/** Geometry is a float vector in NIBArchive nibs and a string such as "{{0, 0}, {320, 44}}" in keyed-archive nibs. */
function geometry(host: NibViewHost, pointer: number, count: number): number[] {
  if (!host.isString(pointer)) {
    const bytes = host.bytes(pointer);
    return Array.from({ length: count }, (_, index) => component(bytes, count, index));
  }
  const values = (host.text(pointer).match(NUMBER) ?? []).map(Number);
  if (values.length !== count || !values.every(Number.isFinite))
    throw new Error("Unsupported nib geometry string.");
  return values;
}
/** UIView's keyed-archive decoding, shared by subclasses that decode more keys. */
export async function decodeView(host: NibViewHost, self: number, coder: number): Promise<number> {
  {
    const boundsPointer = await decoded(host, coder, "UIBounds"),
      centerPointer = await decoded(host, coder, "UICenter");
    const [bx = 0, by = 0, bw = 0, bh = 0] = boundsPointer
        ? geometry(host, boundsPointer, RECT_COMPONENTS)
        : [],
      bounds: Rectangle = [bx, by, bw, bh];
    const center = centerPointer ? geometry(host, centerPointer, POINT_COMPONENTS) : undefined;
    const half = 2;
    const x = center ? (center[0] ?? 0) - bounds[GeometryField.Width] / half : 0,
      y = center ? (center[1] ?? 0) - bounds[GeometryField.Height] / half : 0;
    host.setFrame(self, [x, y, bounds[GeometryField.Width], bounds[GeometryField.Height]]);
    host.view(self).bounds = bounds;
    for (const [key, setter, decode] of [
      ["UIOpaque", "setOpaque:", "decodeBoolForKey:"],
      ["UIAutoresizeSubviews", "setAutoresizesSubviews:", "decodeBoolForKey:"],
      ["UIAutoresizingMask", "setAutoresizingMask:", "decodeIntegerForKey:"],
      ["UIClearsContextBeforeDrawing", "setClearsContextBeforeDrawing:", "decodeBoolForKey:"],
      ["UIHidden", "setHidden:", "decodeBoolForKey:"],
      ["UIAlpha", "setAlpha:", "decodeFloatForKey:"],
      ["UITag", "setTag:", "decodeIntegerForKey:"],
      ["UIClipsToBounds", "setClipsToBounds:", "decodeBoolForKey:"],
      ["UIContentMode", "setContentMode:", "decodeIntegerForKey:"],
    ] as const) {
      const keyPointer = host.string(key);
      if (await host.send(coder, "containsValueForKey:", [keyPointer]))
        await host.send(self, setter, [objectResult(await host.send(coder, decode, [keyPointer]))]);
    }
    if (await host.send(coder, "decodeBoolForKey:", [host.string("UIUserInteractionDisabled")]))
      await host.send(self, "setUserInteractionEnabled:", [0]);
    const color = await decoded(host, coder, "UIBackgroundColor");
    if (color) await host.send(self, "setBackgroundColor:", [color]);
    const subviews = await decoded(host, coder, "UISubviews");
    if (subviews)
      for (const view of host.items(subviews)) await host.send(self, "addSubview:", [view]);
    return self;
  }
}
export function installNibViews(host: NibViewHost): void {
  host.method("UIView", false, "initWithCoder:", (self, args) => decodeView(host, self, args(0)));
  installNibControls(host, (self, coder) => decodeView(host, self, coder));
  host.method("UIColor", false, "initWithCoder:", async (self, args) => {
    const coder = args(0),
      read = async (key: string) =>
        objectResult(await host.send(coder, "decodeFloatForKey:", [host.string(key)]));
    const count = objectResult(
      await host.send(coder, "decodeIntegerForKey:", [host.string("UIColorComponentCount")]),
    );
    const white = await read("UIWhite"),
      alpha = await read("UIAlpha");
    if (count !== POINT_COMPONENTS && count !== RECT_COMPONENTS)
      throw new Error("Unsupported nib color space.");
    const channels =
      count === POINT_COMPONENTS
        ? [white, white, white, alpha]
        : [await read("UIRed"), await read("UIGreen"), await read("UIBlue"), alpha];
    channels.forEach((value, index) => host.write(self + (index + 1) * WORD_BYTES, value));
    return self;
  });
}
