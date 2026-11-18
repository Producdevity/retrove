/** A screen in portrait points, with its pixel scale. */
export interface ScreenSize {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}
/** iPhone5,1, the model reported by the Darwin sysctl and UIDevice bridges. */
export const TALL_SCREEN: ScreenSize = Object.freeze({ width: 320, height: 568, scale: 2 });
/** What a 4-inch iPhone gives apps built for 3.5-inch screens: a letterboxed 320×480. */
export const LEGACY_SCREEN: ScreenSize = Object.freeze({ width: 320, height: 480, scale: 2 });
export const Orientation = {
  UIInterfaceOrientationPortrait: 1,
  UIInterfaceOrientationPortraitUpsideDown: 2,
  UIInterfaceOrientationLandscapeRight: 3,
  UIInterfaceOrientationLandscapeLeft: 4,
} as const;
const LAST_PORTRAIT = Orientation.UIInterfaceOrientationPortraitUpsideDown;
const PORTRAIT = Orientation.UIInterfaceOrientationPortrait;
const ORIENTATIONS = new Map<string, number>(Object.entries(Orientation));
const orientation = (name: unknown) =>
  typeof name === "string" ? ORIENTATIONS.get(name) : undefined;
export function isLandscape(value: number): boolean {
  return value > LAST_PORTRAIT;
}
export function initialOrientation(info: Readonly<Record<string, unknown>>): number {
  const supported = info["UISupportedInterfaceOrientations"];
  const first: unknown = Array.isArray(supported) ? supported[0] : undefined;
  return orientation(info["UIInterfaceOrientation"]) ?? orientation(first) ?? PORTRAIT;
}
