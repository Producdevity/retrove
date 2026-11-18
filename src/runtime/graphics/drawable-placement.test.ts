import { describe, expect, it } from "vite-plus/test";
import {
  blitRectangle,
  drawablePlacement,
  drawableSize,
  isAxisAligned,
  type LayerGeometry,
} from "./drawable-placement";

const portraitInLandscape: LayerGeometry = {
  width: 320,
  height: 568,
  scale: 1,
  screenScale: 2,
  display: { width: 568, height: 320 },
  // Landscape-right: the window's portrait points turn a quarter clockwise onto the display.
  toDisplay: ([x, y]) => [y, 320 - x],
};

describe("drawable placement", () => {
  it("sizes the renderbuffer from the layer bounds and scale", () => {
    expect(drawableSize({ ...portraitInLandscape, scale: 2 })).toEqual({
      width: 640,
      height: 1136,
    });
    expect(drawableSize({ ...portraitInLandscape, scale: 0 })).toEqual({
      width: 640,
      height: 1136,
    });
    expect(drawableSize({ ...portraitInLandscape, width: 0 })).toBeUndefined();
  });
  it("fills the display unrotated when the layer matches it", () => {
    const placement = drawablePlacement({
      ...portraitInLandscape,
      width: 568,
      height: 320,
      toDisplay: (point) => point,
    });
    expect(placement).toEqual({ origin: [-1, -1], u: [2, 0], v: [0, 2] });
    expect(isAxisAligned(placement)).toBe(true);
    expect(blitRectangle(placement, { width: 1136, height: 640 })).toEqual([0, 0, 1136, 640]);
  });
  it("turns a portrait layer shown in a landscape interface", () => {
    const placement = drawablePlacement(portraitInLandscape);
    expect(placement.origin).toEqual([1, -1]);
    expect(placement.u).toEqual([0, 2]);
    expect(placement.v).toEqual([-2, 0]);
    expect(isAxisAligned(placement)).toBe(false);
  });
  it("places a smaller layer inside the display", () => {
    const placement = drawablePlacement({
      width: 160,
      height: 284,
      scale: 1,
      screenScale: 2,
      display: { width: 320, height: 568 },
      toDisplay: ([x, y]) => [x + 80, y + 142],
    });
    expect(blitRectangle(placement, { width: 640, height: 1136 })).toEqual([160, 284, 480, 852]);
  });
});
