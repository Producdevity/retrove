import type { FoundationHost } from "../../objc/host";
import { DropReason } from "../../../diagnostics/input-metrics";
export interface TouchViewState {
  interactive: boolean;
  multi: boolean;
  exclusive: boolean;
}
interface TouchViewHost extends Pick<FoundationHost, "method"> {
  state(pointer: number): TouchViewState;
}
export function installTouchViewProperties(host: TouchViewHost): void {
  for (const [getter, setter, key] of [
    ["isUserInteractionEnabled", "setUserInteractionEnabled:", "interactive"],
    ["isMultipleTouchEnabled", "setMultipleTouchEnabled:", "multi"],
    ["isExclusiveTouch", "setExclusiveTouch:", "exclusive"],
  ] as const) {
    host.method("UIView", false, getter, (self) => Number(host.state(self)[key]));
    host.method("UIView", false, setter, (self, args) => {
      host.state(self)[key] = Boolean(args(0));
    });
  }
}
export function touchConflict(
  state: (pointer: number) => TouchViewState,
  target: number,
  active: Iterable<number>,
): typeof DropReason.Occupied | typeof DropReason.Exclusive | undefined {
  const view = state(target);
  for (const pointer of active) {
    if (pointer === target) {
      if (!view.multi) return DropReason.Occupied;
    } else if (view.exclusive || state(pointer).exclusive) return DropReason.Exclusive;
  }
  return undefined;
}
