import { expect, test } from "vite-plus/test";
import { initialOrientation } from "./screen";

test("initial orientation prefers the declared orientation, then the first supported one", () => {
  expect(
    initialOrientation({ UIInterfaceOrientation: "UIInterfaceOrientationLandscapeLeft" }),
  ).toBe(4);
  expect(
    initialOrientation({
      UISupportedInterfaceOrientations: ["UIInterfaceOrientationLandscapeRight"],
    }),
  ).toBe(3);
  expect(initialOrientation({ UIInterfaceOrientation: "constructor" })).toBe(1);
  expect(initialOrientation({})).toBe(1);
});
