import { expect, test } from "vite-plus/test";
import {
  CombineFunction,
  CombineOperand,
  CombineSource,
  combineExpression,
  defaultCombine,
  setCombine,
} from "./texture-combine";

test("combiner parameters accept only the values ES 1.1 allows for each slot", () => {
  const combine = defaultCombine();
  expect(setCombine(combine, 0x8571, CombineFunction.Dot3RGB)).toBe(true);
  expect(setCombine(combine, 0x8572, CombineFunction.Dot3RGB)).toBe(false);
  expect(setCombine(combine, 0x8582, CombineSource.PrimaryColor)).toBe(true);
  expect(setCombine(combine, 0x859a, CombineOperand.Color)).toBe(false);
  expect(setCombine(combine, 0x0d1c, 4)).toBe(true);
  expect(setCombine(combine, 0x0d1c, 3)).toBe(false);
  expect(combine).toMatchObject({
    rgb: CombineFunction.Dot3RGB,
    rgbSources: [CombineSource.Texture, CombineSource.Previous, CombineSource.PrimaryColor],
    alphaScale: 4,
  });
});

test("interpolate mixes the second argument toward the first by the third", () => {
  const combine = defaultCombine();
  setCombine(combine, 0x8571, CombineFunction.Interpolate);
  setCombine(combine, 0x8592, CombineOperand.OneMinusAlpha);
  setCombine(combine, 0x8573, 2);
  expect(combineExpression(combine, 1)).toBe(
    "color = clamp(vec4((mix(color.rgb, texel.rgb, vec3(1.0 - uEnvironment1.a))) * 2.0, ((texel.a * color.a)) * 1.0), 0.0, 1.0);",
  );
});
