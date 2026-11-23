import { ImageComponents } from "./image-metadata";
import { imageFromProvider } from "./quartz-images";
import type { QuartzObjects } from "./quartz-objects";
import type { Imports } from "./context-calls";

/** Reference counting plus the color space, data provider and image constructors. */
export function objectImports(objects: QuartzObjects): Imports {
  const retain: Imports[string] = (a) => objects.retain(a(0));
  const release: Imports[string] = (a) => objects.release(a(0));
  return {
    _CGContextRetain: retain,
    _CGContextRelease: release,
    _CGColorSpaceCreateDeviceRGB: () =>
      objects.add({ kind: "space", components: ImageComponents.RGB }),
    _CGColorSpaceCreateDeviceGray: () =>
      objects.add({ kind: "space", components: ImageComponents.Gray }),
    _CGColorSpaceRelease: release,
    _CGColorSpaceRetain: retain,
    _CGDataProviderCreateWithCFData: (a) => {
      const data = a(0);
      if (!data) return 0;
      const pointer = objects.add({ kind: "provider", data });
      if (pointer) objects.objc.retainObject(data);
      return pointer;
    },
    _CGDataProviderRelease: release,
    _CGImageCreate: (a) => imageFromProvider(objects, a),
    _CGImageRetain: retain,
    _CGImageRelease: release,
  };
}
