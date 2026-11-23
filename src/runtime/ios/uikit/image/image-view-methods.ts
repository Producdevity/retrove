import { ImageViewAnimations } from "./animation";
import { UIKitClass } from "../host";
import { UIImageClass, type ImagesHost } from "./image-types";
import type { ImageStore } from "./image-store";

const VIEW = UIImageClass.View;
type ImageKey = "image" | "highlightedImage";

/** UIImageView: its image and highlighted image, and the animation frames it cycles through. */
export function installImageViewMethods(host: ImagesHost, store: ImageStore): ImageViewAnimations {
  const { method } = host;
  host.hostClass(VIEW, UIKitClass.View);
  const animations = new ImageViewAnimations({
    method,
    retain: (pointer) => host.retain(pointer),
    release: (pointer) => host.releaseFromHost(pointer),
    elements: (array) => host.elements(array),
    now: () => performance.now(),
    changed: (view) => {
      host.data(view).needsDisplay = true;
    },
  });
  animations.install();
  async function setImage(self: number, pointer: number, key: ImageKey): Promise<void> {
    const view = host.data(self);
    const old = view[key];
    view[key] = host.retain(pointer);
    view.needsDisplay = true;
    if (old) await host.releaseFromHost(old);
  }
  method(VIEW, false, "image", (self) => host.data(self).image ?? 0);
  method(VIEW, false, "setImage:", (self, args) => setImage(self, args(0), "image"));
  method(VIEW, false, "highlightedImage", (self) => host.data(self).highlightedImage ?? 0);
  method(VIEW, false, "setHighlightedImage:", (self, args) =>
    setImage(self, args(0), "highlightedImage"),
  );
  method(VIEW, false, "isHighlighted", (self) => Number(Boolean(host.data(self).highlighted)));
  method(VIEW, false, "setHighlighted:", (self, args) => {
    const view = host.data(self);
    view.highlighted = Boolean(args(0));
    view.needsDisplay = true;
  });
  method(VIEW, false, "initWithImage:", async (self, args) => {
    const image = args(0);
    const record = store.images.get(image);
    host.setFrame(self, [0, 0, record?.width ?? 0, record?.height ?? 0]);
    await setImage(self, image, "image");
    return self;
  });
  method(VIEW, false, "initWithImage:highlightedImage:", async (self, args) => {
    const image = args(0);
    const record = store.images.get(image);
    host.setFrame(self, [0, 0, record?.width ?? 0, record?.height ?? 0]);
    await setImage(self, image, "image");
    await setImage(self, args(1), "highlightedImage");
    return self;
  });
  method(UIKitClass.View, false, "drawRect:", () => {});
  return animations;
}
