import { expect, test } from "vite-plus/test";
import { LEGACY_SCREEN, TALL_SCREEN } from "../uikit/screen";
import { appProfile } from "./app-manifest";

const manifest = { Legacy: { screen: "legacy" }, Wide: { orientation: "landscape" } } as const;

test("apps without an entry keep their Info.plist orientation on the tall screen", () => {
  const profile = appProfile(
    { CFBundleIdentifier: "Other", UIInterfaceOrientation: "UIInterfaceOrientationLandscapeLeft" },
    manifest,
  );
  expect(profile.entry).toBeUndefined();
  expect(profile.screen).toBe(TALL_SCREEN);
  expect(profile.orientation).toBe(4);
  expect(profile.allowsOrientation(1)).toBe(true);
});

test("manifest entries letterbox the screen and pin the orientation family", () => {
  expect(appProfile({ CFBundleIdentifier: "Legacy" }, manifest).screen).toBe(LEGACY_SCREEN);
  const wide = appProfile({ CFBundleIdentifier: "Wide" }, manifest);
  expect(wide.orientation).toBe(3);
  expect([1, 2, 3, 4].map((value) => wide.allowsOrientation(value))).toEqual([
    false,
    false,
    true,
    true,
  ]);
  expect(appProfile({ CFBundleIdentifier: "__proto__" }, manifest).entry).toBeUndefined();
});
