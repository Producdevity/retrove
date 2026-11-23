import {
  LEGACY_SCREEN,
  Orientation,
  TALL_SCREEN,
  initialOrientation,
  isLandscape,
  type ScreenSize,
} from "../uikit/screen";
import { Scheduling } from "../threads/scheduling";

/** Per-app overrides for behaviour that cannot be derived from the bundle itself. */
export interface ManifestEntry {
  /** Run on the letterboxed 320×480 screen a 4-inch iPhone gives 3.5-inch apps. */
  readonly screen?: "legacy";
  /** Keep the interface in this orientation family, whatever Info.plist or the app asks. */
  readonly orientation?: "portrait" | "landscape";
  /** Thread switching that suits the game; the tester's setting can override it. */
  readonly scheduling?: Scheduling;
}
const MANIFEST: Readonly<Record<string, ManifestEntry>> = {
  // Lays out its GL HUD from UIScreen bounds inside a window fixed at 320×480.
  Gyrotate: { screen: "legacy" },
  // Unreal Engine 3 renders for landscape only.
  "com.hip.180282": { orientation: "landscape", scheduling: Scheduling.Blocks },
};

export interface AppProfile {
  readonly bundleId: string;
  readonly entry: ManifestEntry | undefined;
  readonly screen: ScreenSize;
  readonly orientation: number;
  /** Whether the app may switch to `orientation`. */
  allowsOrientation(value: number): boolean;
}

export function appProfile(
  info: Readonly<Record<string, unknown>>,
  manifest: Readonly<Record<string, ManifestEntry>> = MANIFEST,
): AppProfile {
  const id = info["CFBundleIdentifier"],
    bundleId = typeof id === "string" ? id : "";
  const entry = Object.hasOwn(manifest, bundleId) ? manifest[bundleId] : undefined;
  const family = entry?.orientation;
  const allowsOrientation = (value: number) =>
    family === undefined || isLandscape(value) === (family === "landscape");
  const declared = initialOrientation(info);
  const fallback =
    family === "landscape"
      ? Orientation.UIInterfaceOrientationLandscapeRight
      : Orientation.UIInterfaceOrientationPortrait;
  return {
    bundleId,
    entry,
    screen: entry?.screen === "legacy" ? LEGACY_SCREEN : TALL_SCREEN,
    orientation: allowsOrientation(declared) ? declared : fallback,
    allowsOrientation,
  };
}
