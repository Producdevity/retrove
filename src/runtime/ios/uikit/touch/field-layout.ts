import { GeometryField } from "../../abi/scalars";
import type { UiContext } from "./context";

export type FieldLayout = (self: number) => Partial<CSSStyleDeclaration> | undefined;

/** CSS placement of a native-element view (web view, text field) over the page canvas. */
export function createFieldLayout(ctx: UiContext): FieldLayout {
  const { state, kit, geo, mediaHost } = ctx;
  const { data } = kit;
  return (self) => {
    const window = state.window;
    if (!window) return undefined;
    let alpha = 1;
    for (let pointer = self; pointer; pointer = data(pointer).parent) {
      const value = data(pointer);
      if (value.hidden) return undefined;
      alpha *= value.alpha;
      if (pointer === window) break;
      if (!value.parent) return undefined;
    }
    const [bx, by, width, height] = data(self).bounds;
    const display = geo.displayBounds(window);
    const host = mediaHost
      ? { width: mediaHost.offsetWidth, height: mediaHost.offsetHeight }
      : undefined;
    const displayWidth = display[GeometryField.Width];
    const displayHeight = display[GeometryField.Height];
    if (!host || !width || !height || !displayWidth || !displayHeight) return undefined;
    const origin = geo.displayPoint([bx, by], self, window);
    const xAxis = geo.displayPoint([bx + 1, by], self, window);
    const yAxis = geo.displayPoint([bx, by + 1], self, window);
    const scaleX = host.width / displayWidth;
    const scaleY = host.height / displayHeight;
    const matrix = [
      (xAxis[0] - origin[0]) * scaleX,
      (xAxis[1] - origin[1]) * scaleY,
      (yAxis[0] - origin[0]) * scaleX,
      (yAxis[1] - origin[1]) * scaleY,
      0,
      0,
    ];
    return {
      clipPath: geo.clip(self),
      left: `${(origin[0] - display[0]) * scaleX}px`,
      top: `${(origin[1] - display[1]) * scaleY}px`,
      width: `${width}px`,
      height: `${height}px`,
      opacity: String(alpha),
      transform: `matrix(${matrix.join(",")})`,
    };
  };
}
