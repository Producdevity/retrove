// iPhone5,1, the model reported by the Darwin sysctl and UIDevice bridges.
export const phoneScreen = Object.freeze({ width: 320, height: 568, scale: 2 });
const Orientation = {
  UIInterfaceOrientationPortrait: 1,
  UIInterfaceOrientationPortraitUpsideDown: 2,
  UIInterfaceOrientationLandscapeRight: 3,
  UIInterfaceOrientationLandscapeLeft: 4,
} as const;
const PORTRAIT = Orientation.UIInterfaceOrientationPortrait;
const ORIENTATIONS = new Map<string, number>(Object.entries(Orientation));
const orientation = (name: unknown) =>
  typeof name === "string" ? ORIENTATIONS.get(name) : undefined;
export function initialOrientation(info: Readonly<Record<string, unknown>>): number {
  const supported = info["UISupportedInterfaceOrientations"];
  const first: unknown = Array.isArray(supported) ? supported[0] : undefined;
  return orientation(info["UIInterfaceOrientation"]) ?? orientation(first) ?? PORTRAIT;
}
