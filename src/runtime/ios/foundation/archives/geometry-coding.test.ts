import { expect, test } from "vite-plus/test";
import { geometryText, geometryValues } from "./geometry-coding";

test("geometry strings match NSStringFromCGRect and read back", () => {
  const rect = (v: readonly string[]) => `{{${v[0]}, ${v[1]}}, {${v[2]}, ${v[3]}}}`;
  const text = geometryText([1.5, -2, 320, 0.1234567], rect);
  expect(text).toBe("{{1.5, -2}, {320, 0.123457}}");
  expect(geometryValues(text, 4)).toEqual([1.5, -2, 320, 0.123457]);
  expect(geometryValues("{1, 2}", 4)).toEqual([0, 0, 0, 0]);
});
