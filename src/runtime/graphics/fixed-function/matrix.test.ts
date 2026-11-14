import { expect, test } from "vite-plus/test";
import {
  frustum,
  identity,
  multiply,
  orthographic,
  rotation,
  scaling,
  transform,
  translation,
} from "./matrix";
import { MatrixError, MatrixMode, MatrixState, MODEL_VIEW_STACK_DEPTH } from "./matrix-stack";

test("OpenGL post-multiplication applies scale before the existing translation", () => {
  const value = multiply(translation(10, 20, 30), scaling(2, 3, 4));
  expect(transform(value, [1, 2, 3, 1])).toEqual([12, 26, 42, 1]);
  expect(transform(value, [1, 2, 3, 0])).toEqual([2, 6, 12, 0]);
  expect(multiply(identity(), value)).toEqual(value);
});
test("axis-angle rotation is right handed and normalizes its axis", () => {
  const result = transform(rotation(90, 0, 0, 3), [1, 0, 0, 1]);
  expect(result[0]).toBeCloseTo(0);
  expect(result[1]).toBeCloseTo(1);
  expect(result[2]).toBe(0);
  expect(result[3]).toBe(1);
  const arbitrary = rotation(73, 2, -3, 4),
    inverse = rotation(-73, 2, -3, 4);
  const restored = transform(multiply(arbitrary, inverse), [7, 8, 9, 1]);
  restored.forEach((value, index) => expect(value).toBeCloseTo([7, 8, 9, 1][index] ?? NaN, 5));
});
test("orthographic and perspective volumes map clipping planes to normalized device coordinates", () => {
  const volume = { left: -2, right: 6, bottom: -3, top: 5, near: 2, far: 10 };
  const ortho = orthographic(volume),
    perspective = frustum(volume);
  if (!ortho || !perspective) throw new Error("Projection fixture is invalid.");
  expect(transform(ortho, [-2, -3, -2, 1])).toEqual([-1, -1, -1, 1]);
  expect(transform(ortho, [6, 5, -10, 1])).toEqual([1, 1, 1, 1]);
  expect(transform(perspective, [-2, -3, -2, 1])).toEqual([-2, -2, -2, 2]);
  expect(transform(perspective, [30, 25, -10, 1])).toEqual([10, 10, 10, 10]);
  expect(orthographic({ ...volume, right: volume.left })).toBeUndefined();
  expect(frustum({ ...volume, near: 0 })).toBeUndefined();
});
test("matrix stacks preserve values on errors and separate projection and texture units", () => {
  const state = new MatrixState();
  state.load(translation(1, 2, 3));
  const original = state.current.value.slice();
  expect(state.pop()).toBe(MatrixError.Underflow);
  expect(state.current.value).toEqual(original);
  for (let level = 1; level < MODEL_VIEW_STACK_DEPTH; level++) expect(state.push()).toBe(0);
  expect(state.push()).toBe(MatrixError.Overflow);
  expect(state.current.depth).toBe(MODEL_VIEW_STACK_DEPTH);
  state.load(scaling(4, 5, 6));
  state.pop();
  expect(state.current.value).toEqual(original);
  state.select(MatrixMode.Projection);
  expect(state.current.value).toEqual(identity());
  state.select(MatrixMode.Texture);
  state.load(translation(9, 0, 0));
  state.textureUnit = 1;
  expect(state.current.value).toEqual(identity());
  expect(state.texture(0).value).toEqual(translation(9, 0, 0));
  expect(state.select(0)).toBe(MatrixError.InvalidEnum);
  expect(state.mode).toBe(MatrixMode.Texture);
  const supplied = translation(4, 5, 6);
  state.load(supplied);
  supplied.fill(0);
  expect(state.current.value).toEqual(translation(4, 5, 6));
});
