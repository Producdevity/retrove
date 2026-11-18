import type { UIKitHost } from "../host";

export const NavigationClass = {
  Controller: "UIViewController",
  Navigation: "UINavigationController",
  Bar: "UINavigationBar",
  Item: "UINavigationItem",
  BarItem: "UIBarButtonItem",
  View: "UIView",
} as const;
/** UINavigationBar's fixed portrait height. */
export const BAR_HEIGHT = 44;

export interface NavigationHost extends UIKitHost {
  classNamed(name: string): number;
  selector(name: string): number;
  /** An autoreleased NSArray holding `values`. */
  array(values: readonly number[]): number;
  elements(array: number): readonly number[];
  keyWindow(): number;
  readonly bars: {
    adopt(className: string, release?: (self: number) => Promise<void>): void;
    setItems(self: number, array: number): Promise<void>;
  };
}

/** Which controller presented or contains which, for parentViewController and dismissal. */
export class ControllerTree {
  /** Presented controller to its presenter. */
  readonly presenters = new Map<number, number>();
  /** Presenter to the controller it presents modally. */
  readonly presented = new Map<number, number>();
  /** Child controller to its navigation controller. */
  readonly containers = new Map<number, number>();
  parent(controller: number): number {
    return this.containers.get(controller) ?? this.presenters.get(controller) ?? 0;
  }
  /** The navigation controller holding `controller`, or `controller` when it is one. */
  navigation(controller: number, isNavigation: (pointer: number) => boolean): number {
    const seen = new Set<number>();
    for (let current = controller; current && !seen.has(current); current = this.parent(current)) {
      seen.add(current);
      if (isNavigation(current)) return current;
    }
    return 0;
  }
}
