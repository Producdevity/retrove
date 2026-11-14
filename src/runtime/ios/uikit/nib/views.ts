import { GeometryField, WORD_BYTES } from "../../abi/scalars";
import { objectResult, type UIKitHost, type Rectangle } from "../host";
const FLOAT_VECTOR = 6;
const RECT_COMPONENTS = 4;
const POINT_COMPONENTS = 2;
interface NibViewHost extends UIKitHost {
  bytes(pointer: number): Uint8Array;
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
export function installNibViews(host: NibViewHost): void {
  host.method("UIView", false, "initWithCoder:", async (self, args) => {
    const coder = args(0),
      boundsPointer = await decoded(host, coder, "UIBounds"),
      centerPointer = await decoded(host, coder, "UICenter");
    const bounds: Rectangle = boundsPointer
      ? (() => {
          const bytes = host.bytes(boundsPointer);
          return [
            component(bytes, RECT_COMPONENTS, 0),
            component(bytes, RECT_COMPONENTS, 1),
            component(bytes, RECT_COMPONENTS, GeometryField.Width),
            component(bytes, RECT_COMPONENTS, GeometryField.Height),
          ];
        })()
      : [0, 0, 0, 0];
    const center = centerPointer ? host.bytes(centerPointer) : undefined;
    const half = 2;
    const x = center
        ? component(center, POINT_COMPONENTS, 0) - bounds[GeometryField.Width] / half
        : 0,
      y = center ? component(center, POINT_COMPONENTS, 1) - bounds[GeometryField.Height] / half : 0;
    host.setFrame(self, [x, y, bounds[GeometryField.Width], bounds[GeometryField.Height]]);
    host.view(self).bounds = bounds;
    for (const [key, setter, decode] of [
      ["UIOpaque", "setOpaque:", "decodeBoolForKey:"],
      ["UIAutoresizeSubviews", "setAutoresizesSubviews:", "decodeBoolForKey:"],
      ["UIAutoresizingMask", "setAutoresizingMask:", "decodeIntegerForKey:"],
      ["UIClearsContextBeforeDrawing", "setClearsContextBeforeDrawing:", "decodeBoolForKey:"],
      ["UIHidden", "setHidden:", "decodeBoolForKey:"],
      ["UIAlpha", "setAlpha:", "decodeFloatForKey:"],
    ] as const) {
      const keyPointer = host.string(key);
      if (await host.send(coder, "containsValueForKey:", [keyPointer]))
        await host.send(self, setter, [objectResult(await host.send(coder, decode, [keyPointer]))]);
    }
    const color = await decoded(host, coder, "UIBackgroundColor");
    if (color) await host.send(self, "setBackgroundColor:", [color]);
    const subviews = await decoded(host, coder, "UISubviews");
    if (subviews)
      for (const view of host.items(subviews)) await host.send(self, "addSubview:", [view]);
    return self;
  });
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
