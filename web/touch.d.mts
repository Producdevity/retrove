import type { DrawableLayer } from "../src/runtime/graphics/drawable";
import type { WebViews } from "../src/runtime/ios/uikit/web-view";
/** UIKit views, touches, alerts and collections over the page. */
export interface TouchUIKit {
  readonly webViews: WebViews;
  readonly drawableGeometry: (layer: number) => DrawableLayer | undefined;
  readonly snapshot: () => unknown;
  readonly scene: (className: (pointer: number) => string | undefined) => unknown;
  readonly connect: () => void;
  readonly disconnect: () => void;
  readonly withAnimation: <T>(seconds: number, delay: number, options: number, changes: () => Promise<T>) => Promise<T>;
  readonly close: () => void;
  readonly pumpAlerts: () => Promise<void>;
  readonly hasAlerts: () => boolean;
  readonly pump: () => Promise<void>;
  readonly cancelTouches: () => Promise<void>;
  readonly hasWindow: () => boolean;
  readonly items: (pointer: number) => number[];
  readonly array: (items: number[], mutable?: boolean) => number;
}
export function touchUIKit(host: Readonly<Record<string, unknown>>): TouchUIKit;
