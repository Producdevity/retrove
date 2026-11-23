import { ImageCompositor } from "./image-compositor";
import { installImageMethods } from "./image-methods";
import { ImageStore } from "./image-store";
import { installImageViewMethods } from "./image-view-methods";
import type { ImageDrawContext, ImagesHost } from "./image-types";

export type { ImagesHost, ImageViewData } from "./image-types";
export interface UIImages {
  render(window: number): Promise<void>;
  close(): void;
  removeView(view: number): void;
  size(pointer: number): [number, number];
  drawImage(
    pointer: number,
    context: ImageDrawContext | undefined,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
}

/** UIImage and UIImageView, and the compositor that mirrors views as canvases. */
export function uiImages(host: ImagesHost): UIImages {
  const store = new ImageStore(host);
  installImageMethods(host, store);
  const animations = installImageViewMethods(host, store);
  const compositor = new ImageCompositor(host, store, animations);
  return {
    render: (window) => compositor.render(window),
    close: () => compositor.close(),
    removeView: (view) => compositor.removeView(view),
    size: (pointer) => store.size(pointer),
    drawImage: (pointer, context, x, y, width, height) => {
      store.draw(store.images.get(pointer), context, x, y, width, height);
    },
  };
}
