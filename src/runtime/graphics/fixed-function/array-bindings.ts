import { floatFromBits } from "../../ios/abi/scalars";
import { Attribute } from "./shader";
import { Component, FIXED_SCALE, GL, type GraphicsBridge } from "./host";
import type { FixedState } from "./state";
const MIN_ARRAY_COMPONENTS = 2;
const PointerArgument = { Size: 0, Type: 1, Stride: 2, Pointer: 3 } as const;
const COLOR_COMPONENTS = 4;
const NORMAL_COMPONENTS = 3;
const BYTE_MAX = 255;
export function arrayAttribute(state: FixedState, name: number): number | undefined {
  switch (name) {
    case GL.VertexArray:
      return Attribute.Position;
    case GL.ColorArray:
      return Attribute.Color;
    case GL.NormalArray:
      return Attribute.TextureStart + state.textures.length;
    case GL.TextureArray:
      return Attribute.TextureStart + state.clientTexture;
    case GL.PointSizeArray:
      return Attribute.PointSize;
  }
  return undefined;
}
/** The attributes a draw feeds: position, colour, texture units and OES point sizes. */
function drawAttributes(state: FixedState): number[] {
  return [
    ...Array.from({ length: Attribute.TextureStart + state.textures.length }, (_, index) => index),
    Attribute.PointSize,
  ];
}
/** glPointSizePointerOES(type, stride, pointer): one float size per vertex. */
const PointSizeArgument = { Type: 0, Stride: 1, Pointer: 2 } as const;
function installPointSizes(bridge: GraphicsBridge, current: () => FixedState): void {
  bridge.register("PointSizePointerOES", (args) => {
    const type = args(PointSizeArgument.Type),
      stride = args(PointSizeArgument.Stride) | 0;
    if (stride < 0) {
      bridge.host.error(GL.InvalidValue);
      return;
    }
    if (type === GL.Fixed) throw new Error("ES 1 fixed-point client arrays are not implemented.");
    if (type !== GL.Float) {
      bridge.host.error(GL.InvalidEnum);
      return;
    }
    current().arrays.set(Attribute.PointSize, {
      size: 1,
      type,
      stride,
      pointer: args(PointSizeArgument.Pointer),
      buffer: bridge.host.boundArray(),
    });
  });
}
export function installArrays(bridge: GraphicsBridge, current: () => FixedState): void {
  for (const [name, enabled] of [
    ["EnableClientState", true],
    ["DisableClientState", false],
  ] as const)
    bridge.register(name, (args) => {
      const state = current(),
        attribute = arrayAttribute(state, args(0));
      if (attribute === undefined) {
        bridge.host.error(GL.InvalidEnum);
        return;
      }
      if (enabled) state.enabledArrays.add(attribute);
      else state.enabledArrays.delete(attribute);
    });
  for (const [name, attribute] of [
    ["VertexPointer", Attribute.Position],
    ["ColorPointer", Attribute.Color],
    ["TexCoordPointer", undefined],
    ["NormalPointer", NORMAL_COMPONENTS],
  ] as const)
    bridge.register(name, (args) => {
      const state = current(),
        normal = name === "NormalPointer";
      const size = normal ? NORMAL_COMPONENTS : args(0),
        type = args(normal ? 0 : PointerArgument.Type),
        stride = args(normal ? 1 : PointerArgument.Stride) | 0,
        pointer = args(normal ? PointerArgument.Stride : PointerArgument.Pointer);
      if (
        stride < 0 ||
        size < MIN_ARRAY_COMPONENTS ||
        size > COLOR_COMPONENTS ||
        (name === "ColorPointer" && size !== COLOR_COMPONENTS)
      ) {
        bridge.host.error(GL.InvalidValue);
        return;
      }
      if (type === GL.Fixed) throw new Error("ES 1 fixed-point client arrays are not implemented.");
      if (![GL.Float, GL.Byte, GL.Short, GL.UnsignedByte].some((value) => value === type)) {
        bridge.host.error(GL.InvalidEnum);
        return;
      }
      const index = normal
        ? Attribute.TextureStart + state.textures.length
        : (attribute ?? Attribute.TextureStart + state.clientTexture);
      state.arrays.set(index, { size, type, stride, pointer, buffer: bridge.host.boundArray() });
    });
  installPointSizes(bridge, current);
  for (const [name, decode] of [
    ["Color4f", floatFromBits],
    ["Color4x", (word: number) => (word | 0) / FIXED_SCALE],
    ["Color4ub", (word: number) => word / BYTE_MAX],
  ] as const)
    bridge.register(name, (args) => {
      const clamp = (index: number) => Math.max(0, Math.min(1, decode(args(index))));
      current().color = [
        clamp(Component.X),
        clamp(Component.Y),
        clamp(Component.Z),
        clamp(Component.W),
      ];
    });
  for (const [suffix, decode] of [
    ["f", floatFromBits],
    ["x", (word: number) => (word | 0) / FIXED_SCALE],
  ] as const) {
    bridge.register("Normal3" + suffix, (args) => {
      current().normal = [decode(args(0)), decode(args(1)), decode(args(Component.Z))];
    });
    bridge.register("PointSize" + suffix, (args) => {
      const size = decode(args(0));
      if (size <= 0) bridge.host.error(GL.InvalidValue);
      else current().pointSize = size;
    });
  }
  bridge.register("ShadeModel", (args) => {
    if (args(0) !== GL.Smooth) throw new Error("ES 1 flat shading is not implemented.");
  });
}
export function prepareArrays(bridge: GraphicsBridge, state: FixedState): boolean {
  if (!state.enabledArrays.has(Attribute.Position)) return false;
  const saved = bridge.host.boundArray();
  try {
    for (const index of drawAttributes(state)) {
      if (!state.enabledArrays.has(index)) {
        bridge.call("DisableVertexAttribArray", [index]);
        continue;
      }
      const pointer = state.arrays.get(index);
      if (!pointer) {
        bridge.host.error(GL.InvalidOperation);
        return false;
      }
      bridge.call("BindBuffer", [GL.ArrayBuffer, pointer.buffer]);
      bridge.call("VertexAttribPointer", [
        index,
        pointer.size,
        pointer.type,
        Number(index === Attribute.Color),
        pointer.stride,
        pointer.pointer,
      ]);
      bridge.call("EnableVertexAttribArray", [index]);
    }
    if (!state.enabledArrays.has(Attribute.Color))
      bridge.host.gl().vertexAttrib4f(Attribute.Color, ...state.color);
    return true;
  } finally {
    bridge.call("BindBuffer", [GL.ArrayBuffer, saved]);
  }
}
