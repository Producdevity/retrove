import type { FoundationHost, HostResult } from "../objc/host";
import { floatBits, floatFromBits, WORD_BYTES } from "../abi/scalars";
import { GeometryField } from "../abi/scalars";
import { structureMethod, type UIKitHost } from "./host";
interface LayerHost extends FoundationHost, Pick<UIKitHost, "view" | "setFrame" | "structure"> {
  send(self: number, selector: string): Promise<HostResult>;
}
export function installLayerFactory(host: LayerHost): void {
  installLayerGeometry(host);
  host.method("CALayer", true, "layer", async (klass) => {
    const value = await host.send(host.alloc(klass), "init");
    if (typeof value !== "number") throw new Error("CALayer initializer did not return an object.");
    return host.autorelease(value);
  });
}

function installLayerGeometry(host: LayerHost): void {
  for (const key of ["frame", "bounds"] as const)
    host.structure(
      "CALayer",
      false,
      key,
      structureMethod((self, _args, destination) => {
        host
          .view(self)
          [key].forEach((value, index) =>
            host.write(destination + index * WORD_BYTES, floatBits(value)),
          );
      }),
    );
  host.method("CALayer", false, "setFrame:", (self, args) => {
    host.setFrame(self, [
      floatFromBits(args(GeometryField.X)),
      floatFromBits(args(GeometryField.Y)),
      floatFromBits(args(GeometryField.Width)),
      floatFromBits(args(GeometryField.Height)),
    ]);
  });
}
interface LayerTreeHost extends LayerHost {
  children(pointer: number): number[];
  parent(pointer: number): number;
  attach(parent: number, child: number): void;
  detach(pointer: number): void;
  array(values: number[]): number;
}
export function installLayerTree(host: LayerTreeHost): void {
  host.method("CALayer", false, "addSublayer:", (self, args) => {
    if (args(0)) host.attach(self, args(0));
  });
  host.method("CALayer", false, "superlayer", (self) => host.parent(self));
  host.method("CALayer", false, "sublayers", (self) => host.array(host.children(self)));
  host.method("CALayer", false, "removeFromSuperlayer", async (self) => {
    if (!host.parent(self)) return;
    host.detach(self);
    await host.release(self);
  });
}
