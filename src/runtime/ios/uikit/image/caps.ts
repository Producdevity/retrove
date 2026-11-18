/** Fixed edges of a stretchable UIImage, in points. */
export interface ImageCaps {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
/** Source and destination rectangles, x, y, width and height each. */
export type Slice = readonly [
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
];
/** The column and row next to a cap that -stretchableImageWithLeftCapWidth:topCapHeight: stretches. */
const STRETCHED_PIXELS = 1;

/**
 * Caps for stretchableImageWithLeftCapWidth:topCapHeight:. A zero cap leaves that axis
 * stretching as a whole; otherwise only the one-point band after the cap stretches.
 */
export function stretchableCaps(
  width: number,
  height: number,
  leftCap: number,
  topCap: number,
): ImageCaps {
  const left = Math.max(0, Math.min(leftCap, width)),
    top = Math.max(0, Math.min(topCap, height));
  return {
    left,
    top,
    right: left ? Math.max(0, width - left - STRETCHED_PIXELS) : 0,
    bottom: top ? Math.max(0, height - top - STRETCHED_PIXELS) : 0,
  };
}

/** Destination widths of the start cap, stretched band and end cap along one axis. */
function bands(start: number, end: number, target: number): number[] {
  // Caps shrink proportionally when the destination is smaller than both caps together.
  const fit = start + end > target && start + end > 0 ? target / (start + end) : 1;
  const head = start * fit,
    tail = end * fit;
  return [head, Math.max(0, target - head - tail), tail];
}

/** The nine source-to-destination slices that draw a capped image into a rectangle. */
export function capSlices(
  width: number,
  height: number,
  caps: ImageCaps,
  [x, y, targetWidth, targetHeight]: readonly number[],
): Slice[] {
  const columns = bands(caps.left, caps.right, targetWidth ?? 0),
    rows = bands(caps.top, caps.bottom, targetHeight ?? 0);
  const sourceColumns: [number, number][] = [
    [0, caps.left],
    [caps.left, width - caps.left - caps.right],
    [width - caps.right, caps.right],
  ];
  const sourceRows: [number, number][] = [
    [0, caps.top],
    [caps.top, height - caps.top - caps.bottom],
    [height - caps.bottom, caps.bottom],
  ];
  const slices: Slice[] = [];
  let top = y ?? 0;
  rows.forEach((rowHeight, row) => {
    let left = x ?? 0;
    columns.forEach((columnWidth, column) => {
      const [sx = 0, sw = 0] = sourceColumns[column] ?? [],
        [sy = 0, sh = 0] = sourceRows[row] ?? [];
      if (sw > 0 && sh > 0 && columnWidth > 0 && rowHeight > 0)
        slices.push([sx, sy, sw, sh, left, top, columnWidth, rowHeight]);
      left += columnWidth;
    });
    top += rowHeight;
  });
  return slices;
}
