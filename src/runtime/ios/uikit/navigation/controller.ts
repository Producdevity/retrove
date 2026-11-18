import { Argument } from "../../objc/host";
import { objectResult, type Rectangle } from "../host";
import { NavigationBars } from "./bar";
import { BAR_HEIGHT, ControllerTree, NavigationClass, type NavigationHost } from "./host";
import { NavigationItems } from "./items";
import { installModalPresentation } from "./modal";

const CLASS = NavigationClass.Navigation;
interface Navigation {
  stack: number[];
  bar: number;
  barHidden: boolean;
  loaded: boolean;
  /** The controller whose view is on screen. */
  shown: number;
  delegate: number;
}
export interface NavigationControllerHost extends NavigationHost {
  /** UIViewController's own dealloc, for subclasses that release their state first. */
  deallocController(self: number): Promise<void>;
}

/** UINavigationController's stack, bar and content layout. */
class NavigationControllers {
  readonly tree = new ControllerTree();
  readonly navigations = new Map<number, Navigation>();
  private readonly navigationItems = new Map<number, number>();
  readonly items: NavigationItems;
  readonly bars: NavigationBars;
  constructor(private readonly host: NavigationControllerHost) {
    this.items = new NavigationItems(host, (item) => this.bars.itemChanged(item));
    this.bars = new NavigationBars(host, this.items, (bar) => this.popFromBar(bar));
  }
  state(self: number): Navigation {
    let value = this.navigations.get(self);
    if (!value) {
      value = { stack: [], bar: 0, barHidden: false, loaded: false, shown: 0, delegate: 0 };
      this.navigations.set(self, value);
    }
    return value;
  }
  private async popFromBar(bar: number): Promise<boolean> {
    for (const [self, navigation] of this.navigations)
      if (navigation.bar === bar) {
        await this.pop(self, 1);
        return true;
      }
    return false;
  }
  async navigationItem(controller: number): Promise<number> {
    let item = this.navigationItems.get(controller);
    if (!item) {
      const title = objectResult(await this.host.send(controller, "title"));
      item = this.host.retain(await this.items.create(title));
      this.navigationItems.set(controller, item);
    }
    return item;
  }
  async bar(self: number): Promise<number> {
    const navigation = this.state(self);
    if (!navigation.bar) {
      const pointer = this.host.alloc(this.host.classNamed(NavigationClass.Bar));
      navigation.bar = objectResult(await this.host.send(pointer, "init"));
      await this.host.send(navigation.bar, "setDelegate:", [self]);
    }
    return navigation.bar;
  }
  async layout(self: number): Promise<void> {
    const navigation = this.state(self);
    if (!navigation.loaded) return;
    const container = objectResult(await this.host.send(self, "view")),
      [, , width, height] = this.host.view(container).bounds,
      top = navigation.barHidden ? 0 : BAR_HEIGHT;
    this.host.setFrame(await this.bar(self), [0, 0, width, BAR_HEIGHT]);
    await this.host.send(navigation.bar, "setHidden:", [Number(navigation.barHidden)]);
    if (!navigation.shown) return;
    const content: Rectangle = [0, top, width, Math.max(0, height - top)];
    this.host.setFrame(objectResult(await this.host.send(navigation.shown, "view")), content);
  }
  private async show(self: number, animated: number): Promise<void> {
    const host = this.host,
      navigation = this.state(self),
      top = navigation.stack.at(-1) ?? 0;
    const items = await Promise.all(navigation.stack.map((item) => this.navigationItem(item)));
    await this.bars.setItems(await this.bar(self), items);
    if (!navigation.loaded || navigation.shown === top) return this.layout(self);
    const previous = navigation.shown;
    if (previous) {
      await host.send(previous, "viewWillDisappear:", [animated], true);
      await host.send(objectResult(await host.send(previous, "view")), "removeFromSuperview");
      await host.send(previous, "viewDidDisappear:", [animated], true);
    }
    navigation.shown = top;
    if (!top) return this.layout(self);
    const container = objectResult(await host.send(self, "view")),
      view = objectResult(await host.send(top, "view"));
    await host.send(top, "viewWillAppear:", [animated], true);
    await host.send(container, "addSubview:", [view]);
    await host.send(container, "addSubview:", [navigation.bar]);
    await this.layout(self);
    await host.send(top, "viewDidAppear:", [animated], true);
  }
  async setStack(self: number, controllers: readonly number[], animated: number): Promise<void> {
    const navigation = this.state(self),
      previous = navigation.stack;
    navigation.stack = controllers.map((controller) => {
      this.tree.containers.set(controller, self);
      return this.host.retain(controller);
    });
    await this.show(self, animated);
    for (const controller of previous) {
      if (!navigation.stack.includes(controller)) this.tree.containers.delete(controller);
      await this.host.release(controller);
    }
  }
  /** Pops up to `count` controllers, keeping the root; returns them autoreleased. */
  async pop(self: number, count: number, animated = 1): Promise<number[]> {
    const stack = this.state(self).stack,
      kept = stack.slice(0, Math.max(1, stack.length - count));
    const popped = stack
      .slice(kept.length)
      .map((controller) => this.host.autorelease(this.host.retain(controller)));
    await this.setStack(self, kept, animated);
    return popped;
  }
  async load(self: number): Promise<void> {
    const window = this.host.keyWindow(),
      view = this.host.alloc(this.host.classNamed(NavigationClass.View)),
      container = objectResult(await this.host.send(view, "init"));
    this.host.setFrame(container, window ? [...this.host.view(window).bounds] : [0, 0, 0, 0]);
    await this.host.send(self, "setView:", [this.host.autorelease(container)]);
    await this.host.send(container, "addSubview:", [await this.bar(self)]);
    this.state(self).loaded = true;
    await this.show(self, 0);
  }
  async dispose(self: number): Promise<void> {
    const navigation = this.navigations.get(self);
    this.navigations.delete(self);
    for (const controller of navigation?.stack ?? []) {
      this.tree.containers.delete(controller);
      await this.host.release(controller);
    }
    if (navigation?.bar) await this.host.release(navigation.bar);
    await this.host.deallocController(self);
  }
}

function installStack(host: NavigationControllerHost, controllers: NavigationControllers): void {
  const stack = (self: number) => controllers.state(self).stack;
  host.method(CLASS, false, "initWithRootViewController:", async (self, args) => {
    await controllers.setStack(self, [args(Argument.First)], 0);
    return self;
  });
  host.method(CLASS, false, "viewControllers", (self) => host.array(stack(self)));
  for (const selector of ["setViewControllers:", "setViewControllers:animated:"])
    host.method(CLASS, false, selector, (self, args) =>
      controllers.setStack(self, host.elements(args(Argument.First)), args(Argument.Second)),
    );
  host.method(CLASS, false, "topViewController", (self) => stack(self).at(-1) ?? 0);
  host.method(CLASS, false, "visibleViewController", (self) => {
    const top = stack(self).at(-1) ?? 0,
      presented = controllers.tree.presented;
    return presented.get(self) ?? presented.get(top) ?? top;
  });
  host.method(CLASS, false, "pushViewController:animated:", (self, args) =>
    controllers.setStack(self, [...stack(self), args(Argument.First)], args(Argument.Second)),
  );
  host.method(
    CLASS,
    false,
    "popViewControllerAnimated:",
    async (self, args) => (await controllers.pop(self, 1, args(Argument.First)))[0] ?? 0,
  );
  host.method(CLASS, false, "popToRootViewControllerAnimated:", async (self, args) =>
    host.array(await controllers.pop(self, stack(self).length - 1, args(Argument.First))),
  );
  host.method(CLASS, false, "popToViewController:animated:", async (self, args) => {
    const index = stack(self).indexOf(args(Argument.First));
    if (index < 0) return 0;
    const count = stack(self).length - index - 1;
    return host.array(await controllers.pop(self, count, args(Argument.Second)));
  });
}

function installBarControl(host: NavigationControllerHost, controllers: NavigationControllers) {
  host.method(CLASS, false, "navigationBar", (self) => controllers.bar(self));
  for (const getter of ["isNavigationBarHidden", "navigationBarHidden"])
    host.method(CLASS, false, getter, (self) => Number(controllers.state(self).barHidden));
  for (const setter of ["setNavigationBarHidden:", "setNavigationBarHidden:animated:"])
    host.method(CLASS, false, setter, async (self, args) => {
      controllers.state(self).barHidden = Boolean(args(Argument.First));
      await controllers.layout(self);
    });
  host.method(CLASS, false, "delegate", (self) => controllers.state(self).delegate);
  host.method(CLASS, false, "setDelegate:", (self, args) => {
    controllers.state(self).delegate = args(Argument.First);
  });
}

/** UINavigationController with its bar, items and modal presentation. */
export function installNavigation(host: NavigationControllerHost): void {
  const controllers = new NavigationControllers(host);
  controllers.items.install();
  controllers.bars.install();
  installModalPresentation(host, controllers.tree);
  host.hostClass(CLASS, NavigationClass.Controller);
  installStack(host, controllers);
  installBarControl(host, controllers);
  host.method(CLASS, false, "loadView", (self) => controllers.load(self));
  host.method(CLASS, false, "dealloc", (self) => controllers.dispose(self));
  const tree = controllers.tree;
  host.method(NavigationClass.Controller, false, "navigationController", (self) =>
    tree.navigation(tree.parent(self), (pointer) => controllers.navigations.has(pointer)),
  );
  host.method(NavigationClass.Controller, false, "navigationItem", (self) =>
    controllers.navigationItem(self),
  );
}
