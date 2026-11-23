import { floatBits, floatFromBits, WORD_BYTES } from "../../abi/scalars";
import { callImplementation } from "../../objc/registrars";
import { structureMethod, UIKitClass } from "../host";
import { stretchableCaps } from "./caps";
import { installImageInitializers } from "./initializers";
import { UIImageClass, type ImagesHost } from "./image-types";
import type { ImageStore } from "./image-store";

const Argument = { First: 0, Second: 1, Third: 2, Fourth: 3 } as const;
const RECT_ARGUMENTS = 4;
const NO_ARGUMENTS = () => 0;

function rectArguments(args: (index: number) => number): [number, number, number, number] {
  const [x = 0, y = 0, width = 0, height = 0] = Array.from({ length: RECT_ARGUMENTS }, (_, index) =>
    floatFromBits(args(index)),
  );
  return [x, y, width, height];
}

function installImageDrawing(host: ImagesHost, store: ImageStore): void {
  const { method } = host;
  const image = UIImageClass.Image;
  method(image, false, "drawInRect:", (self, args) => {
    const [x, y, width, height] = rectArguments(args);
    store.coreGraphics()?.drawCurrent((canvas) => {
      store.draw(store.images.get(self), canvas, x, y, width, height);
    });
  });
  method(image, false, "drawAsPatternInRect:", (self, args) => {
    const record = store.images.get(self);
    const rect = rectArguments(args);
    if (record) store.coreGraphics()?.drawCurrent((canvas) => store.tile(record, canvas, rect));
  });
  method(image, false, "drawAtPoint:", (self, args) => {
    const record = store.images.get(self);
    if (!record) return;
    const x = floatFromBits(args(Argument.First));
    const y = floatFromBits(args(Argument.Second));
    store.coreGraphics()?.drawCurrent((canvas) => {
      store.draw(record, canvas, x, y, record.width, record.height);
    });
  });
  method(
    image,
    false,
    "size",
    structureMethod((self, _args, destination) => {
      const [width, height] = store.size(self);
      host.write(destination, floatBits(width));
      host.write(destination + WORD_BYTES, floatBits(height));
    }),
  );
}

function installImageFactories(host: ImagesHost, store: ImageStore): void {
  const { method } = host;
  const image = UIImageClass.Image;
  installImageInitializers({
    method,
    retain: (pointer) => host.retain(pointer),
    release: (pointer) => host.releaseFromHost(pointer),
    imageClass: () => host.names.get(image) ?? 0,
    send: (self, selector, args) => host.send(self, selector, args),
  });
  method(image, true, "imageNamed:", (_, args) =>
    args(Argument.First) ? store.load(host.text(args(Argument.First)), true) : 0,
  );
  method(image, true, "imageWithContentsOfFile:", (_, args) =>
    args(Argument.First) ? store.load(host.text(args(Argument.First)), false) : 0,
  );
  method(image, true, "imageWithCGImage:", (cls, args) =>
    store.fromCG(cls, args(Argument.First), 1, 0),
  );
  method(image, true, "imageWithCGImage:scale:orientation:", (cls, args) =>
    store.fromCG(
      cls,
      args(Argument.First),
      floatFromBits(args(Argument.Second)),
      args(Argument.Third),
    ),
  );
}

function installImageProperties(host: ImagesHost, store: ImageStore): void {
  const { method } = host;
  const image = UIImageClass.Image;
  method(image, false, "CGImage", (self) => {
    const record = store.images.get(self);
    const cg = store.coreGraphics();
    if (!record || !cg) return 0;
    if (!record.pointer) {
      const source = store.source(record);
      const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
      const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
      const context = store.pixelCanvas(width, height).getContext("2d");
      if (!context) throw new Error("UIKit image drawing requires a 2D canvas context");
      context.drawImage(source, 0, 0);
      record.pointer = cg.createImage(
        width,
        height,
        context.getImageData(0, 0, width, height).data,
      );
    }
    return record.pointer;
  });
  method(image, false, "dealloc", async (self) => {
    const pointer = store.images.get(self)?.pointer;
    if (pointer !== undefined) await store.coreGraphics()?.release(pointer);
    store.images.delete(self);
    const base = host.lookup(host.names.get(UIKitClass.Object) ?? 0, "dealloc");
    if (typeof base === "function") await callImplementation(base, self, NO_ARGUMENTS);
    else host.destroy(self);
  });
  method(image, false, "scale", (self) => floatBits(store.images.get(self)?.scale ?? 1));
  method(image, false, "imageOrientation", (self) => store.images.get(self)?.orientation ?? 0);
  method(image, false, "stretchableImageWithLeftCapWidth:topCapHeight:", (self, args) => {
    const record = store.images.get(self);
    if (!record) return 0;
    const pointer = host.alloc(host.read(self));
    store.images.set(pointer, {
      ...record,
      caps: stretchableCaps(
        record.width,
        record.height,
        args(Argument.First) | 0,
        args(Argument.Second) | 0,
      ),
    });
    if (record.pointer) store.coreGraphics()?.retain(record.pointer);
    return host.autorelease(pointer);
  });
  method(image, false, "leftCapWidth", (self) => store.images.get(self)?.caps?.left ?? 0);
  method(image, false, "topCapHeight", (self) => store.images.get(self)?.caps?.top ?? 0);
}

/** The UIImage class: factories, drawing, CGImage bridging and cap insets. */
export function installImageMethods(host: ImagesHost, store: ImageStore): void {
  host.hostClass(UIImageClass.Image, UIImageClass.Object);
  // Compiled nibs archive image references as this UIImage subclass; its UIImage initWithCoder: resolves them.
  host.hostClass(UIImageClass.Placeholder, UIImageClass.Image);
  installImageFactories(host, store);
  installImageDrawing(host, store);
  installImageProperties(host, store);
}
