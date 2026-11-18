import { WORD_BYTES, floatBits } from "../../abi/scalars";
import type { GuestArguments, HostResult } from "../../objc/host";
import type { ScreenSize } from "../screen";

const CLASS = "UIApplication";
/** Portrait status bar height in points before iOS 7 changed the layout. */
export const STATUS_BAR_HEIGHT = 20;
const ORIENTATION_ANIMATION_SECONDS = 0.3;
const LAST_PORTRAIT = 2;
type Method = ((self: number, args: GuestArguments, destination: number) => HostResult) & {
  stret?: true;
};
export interface StatusBarHost {
  method(cls: string, meta: boolean, name: string, implementation: Method): void;
  write(pointer: number, value: number): void;
}
export interface StatusBarState {
  hidden: boolean;
  orientation: number;
  style: number;
}

/** How the app profile constrains the status bar. */
export interface StatusBarDevice {
  readonly screen: ScreenSize;
  allowsOrientation(value: number): boolean;
}

/** UIApplication's status bar: hidden flag, orientation, style and frame in screen points. */
export function statusBarFrame(
  state: StatusBarState,
  screen: ScreenSize,
): [number, number, number, number] {
  if (state.hidden) return [0, 0, 0, 0];
  return state.orientation > LAST_PORTRAIT
    ? [0, 0, STATUS_BAR_HEIGHT, screen.height]
    : [0, 0, screen.width, STATUS_BAR_HEIGHT];
}

export function installStatusBar(
  host: StatusBarHost,
  state: StatusBarState,
  device: StatusBarDevice,
): void {
  for (const name of [
    "setStatusBarHidden:",
    "setStatusBarHidden:animated:",
    "setStatusBarHidden:withAnimation:",
  ])
    host.method(CLASS, false, name, (_self, args) => {
      state.hidden = Boolean(args(0));
    });
  host.method(CLASS, false, "isStatusBarHidden", () => Number(state.hidden));
  host.method(CLASS, false, "statusBarOrientation", () => state.orientation);
  for (const name of ["setStatusBarOrientation:", "setStatusBarOrientation:animated:"])
    host.method(CLASS, false, name, (_self, args) => {
      if (device.allowsOrientation(args(0))) state.orientation = args(0);
    });
  host.method(CLASS, false, "statusBarStyle", () => state.style);
  for (const name of ["setStatusBarStyle:", "setStatusBarStyle:animated:"])
    host.method(CLASS, false, name, (_self, args) => {
      state.style = args(0);
    });
  host.method(CLASS, false, "statusBarOrientationAnimationDuration", () =>
    floatBits(ORIENTATION_ANIMATION_SECONDS),
  );
  const frame: Method = (_self, _args, destination) => {
    statusBarFrame(state, device.screen).forEach((value, index) =>
      host.write(destination + index * WORD_BYTES, floatBits(value)),
    );
  };
  frame.stret = true;
  host.method(CLASS, false, "statusBarFrame", frame);
}
