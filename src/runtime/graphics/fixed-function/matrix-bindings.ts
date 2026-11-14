import { floatFromBits, WORD_BYTES } from "../../ios/abi/scalars";
import {
  identity,
  MATRIX_ELEMENTS,
  orthographic,
  frustum,
  rotation,
  scaling,
  translation,
} from "./matrix";
import { Component, FIXED_SCALE, GL, type GraphicsBridge } from "./host";
import type { FixedState } from "./state";
const VolumeArgument = { Left: 0, Right: 1, Bottom: 2, Top: 3, Near: 4, Far: 5 } as const;
export function installMatrices(bridge: GraphicsBridge, current: () => FixedState): void {
  const apply = (result: number): void => {
    if (result) bridge.host.error(result);
  };
  bridge.register("MatrixMode", (args) => apply(current().matrices.select(args(0))));
  bridge.register("LoadIdentity", () => apply(current().matrices.load(identity())));
  bridge.register("PushMatrix", () => apply(current().matrices.push()));
  bridge.register("PopMatrix", () => apply(current().matrices.pop()));
  for (const [suffix, decode] of [
    ["f", floatFromBits],
    ["x", (word: number) => (word | 0) / FIXED_SCALE],
  ] as const) {
    for (const [name, operation] of [
      ["Translate", translation],
      ["Scale", scaling],
    ] as const)
      bridge.register(name + suffix, (args) =>
        apply(
          current().matrices.multiply(
            operation(decode(args(0)), decode(args(1)), decode(args(Component.Z))),
          ),
        ),
      );
    bridge.register("Rotate" + suffix, (args) =>
      apply(
        current().matrices.multiply(
          rotation(
            decode(args(0)),
            decode(args(1)),
            decode(args(Component.Z)),
            decode(args(Component.W)),
          ),
        ),
      ),
    );
    for (const [name, operation] of [
      ["Ortho", orthographic],
      ["Frustum", frustum],
    ] as const) {
      bridge.register(name + suffix, (args) => {
        const matrix = operation({
          left: decode(args(VolumeArgument.Left)),
          right: decode(args(VolumeArgument.Right)),
          bottom: decode(args(VolumeArgument.Bottom)),
          top: decode(args(VolumeArgument.Top)),
          near: decode(args(VolumeArgument.Near)),
          far: decode(args(VolumeArgument.Far)),
        });
        if (matrix) apply(current().matrices.multiply(matrix));
        else bridge.host.error(GL.InvalidValue);
      });
    }
    for (const name of ["LoadMatrix", "MultMatrix"])
      bridge.register(name + suffix, (args) => {
        const bytes = bridge.host.read(args(0), MATRIX_ELEMENTS * WORD_BYTES),
          view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const matrix = Float32Array.from({ length: MATRIX_ELEMENTS }, (_, index) =>
          decode(view.getUint32(index * WORD_BYTES, true)),
        );
        apply(
          name === "LoadMatrix"
            ? current().matrices.load(matrix)
            : current().matrices.multiply(matrix),
        );
      });
  }
}
