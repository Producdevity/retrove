import { Argument } from "../../objc/host";
import { objectResult } from "../host";
import { NavigationClass, type ControllerTree, type NavigationHost } from "./host";

const CLASS = NavigationClass.Controller;

async function appearance(
  host: NavigationHost,
  controller: number,
  phase: string,
  animated: number,
) {
  await host.send(controller, phase, [animated], true);
}

/** Full-screen modal presentation in the key window, as on iPhone before iOS 5. */
export function installModalPresentation(host: NavigationHost, tree: ControllerTree): void {
  const styles = new Map<number, number>();
  const present = async (self: number, controller: number, animated: number) => {
    if (!controller || tree.presented.has(self)) return;
    const window = host.keyWindow();
    if (!window) throw new Error("Modal view controller presented without a key window.");
    tree.presented.set(self, host.retain(controller));
    tree.presenters.set(controller, self);
    const view = objectResult(await host.send(controller, "view"));
    host.setFrame(view, [...host.view(window).bounds]);
    await appearance(host, controller, "viewWillAppear:", animated);
    await host.send(window, "addSubview:", [view]);
    await appearance(host, controller, "viewDidAppear:", animated);
  };
  const dismiss = async (presenter: number, animated: number): Promise<void> => {
    const controller = tree.presented.get(presenter);
    if (!controller) return;
    await dismiss(controller, animated);
    const view = objectResult(await host.send(controller, "view"));
    await appearance(host, controller, "viewWillDisappear:", animated);
    await host.send(view, "removeFromSuperview");
    tree.presented.delete(presenter);
    tree.presenters.delete(controller);
    await appearance(host, controller, "viewDidDisappear:", animated);
    await host.release(controller);
  };
  host.method(CLASS, false, "presentModalViewController:animated:", (self, args) =>
    present(self, args(Argument.First), args(Argument.Second)),
  );
  host.method(CLASS, false, "dismissModalViewControllerAnimated:", (self, args) => {
    // A presented controller may dismiss itself; UIKit forwards that to its presenter.
    const presenter = tree.presented.has(self) ? self : (tree.presenters.get(self) ?? 0);
    return presenter ? dismiss(presenter, args(Argument.First)) : undefined;
  });
  host.method(CLASS, false, "modalViewController", (self) => tree.presented.get(self) ?? 0);
  host.method(CLASS, false, "parentViewController", (self) => tree.parent(self));
  host.method(CLASS, false, "modalTransitionStyle", (self) => styles.get(self) ?? 0);
  host.method(CLASS, false, "setModalTransitionStyle:", (self, args) => {
    styles.set(self, args(Argument.First));
  });
  for (const phase of [
    "viewWillAppear:",
    "viewDidAppear:",
    "viewWillDisappear:",
    "viewDidDisappear:",
  ])
    host.method(CLASS, false, phase, () => undefined);
}
