import { describe, expect, it } from "vite-plus/test";
import { componentColor, contextDrawingImports, type DrawingCanvas } from "./context-drawing";

const fakeCanvas = (overrides: Partial<DrawingCanvas>): DrawingCanvas => ({
  beginPath: () => undefined,
  moveTo: () => undefined,
  lineTo: () => undefined,
  rect: () => undefined,
  ellipse: () => undefined,
  arcTo: () => undefined,
  bezierCurveTo: () => undefined,
  quadraticCurveTo: () => undefined,
  rotate: () => undefined,
  setLineDash: () => undefined,
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 10,
  lineDashOffset: 0,
  globalCompositeOperation: "source-over",
  ...overrides,
});

describe("context drawing", () => {
  it("reads gray and RGB components", () => {
    expect(componentColor([0.5, 1])).toBe("rgba(127.5,127.5,127.5,1)");
    expect(componentColor([1, 0, 0, 0.5])).toBe("rgba(255,0,0,0.5)");
  });
  it("draws line segments as separate moves and strokes them", () => {
    const calls: string[] = [];
    const canvas = fakeCanvas({
      beginPath: () => void calls.push("begin"),
      moveTo: (x: number, y: number) => void calls.push(`move ${x},${y}`),
      lineTo: (x: number, y: number) => void calls.push(`line ${x},${y}`),
    });
    const imports = contextDrawingImports({
      context: () => canvas,
      bounds: () => undefined,
      draw: (_pointer, mode) => void calls.push(`draw ${mode}`),
      floats: () => [0, 0, 1, 1, 2, 2, 3, 3],
      spaceComponents: () => undefined,
    });
    imports._CGContextStrokeLineSegments?.((index) => [1, 0x100, 4][index] ?? 0);
    expect(calls).toEqual(["begin", "move 0,0", "line 1,1", "move 2,2", "line 3,3", "draw 2"]);
  });
  it("uses the fill color space for component colors", () => {
    const canvas = fakeCanvas({});
    const imports = contextDrawingImports({
      context: () => canvas,
      bounds: () => undefined,
      draw: () => undefined,
      floats: (_address, count) => [0.2, 1, 1, 1].slice(0, count),
      spaceComponents: () => 1,
    });
    imports._CGContextSetFillColorSpace?.((index) => [1, 0x200][index] ?? 0);
    imports._CGContextSetFillColor?.((index) => [1, 0x300][index] ?? 0);
    expect(canvas.fillStyle).toBe(componentColor([0.2, 1]));
  });
});
