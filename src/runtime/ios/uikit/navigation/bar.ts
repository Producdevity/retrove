import { Argument } from "../../objc/host";
import { BarItemStyle, BarSystemItem } from "../toolbar/model";
import { objectResult } from "../host";
import { NavigationClass, type NavigationHost } from "./host";
import type { NavigationItems } from "./items";

const CLASS = NavigationClass.Bar;
const BACK_TITLE = "Back";
/** Stack positions from the end: the top item and the one a back button returns to. */
const Position = { Top: -1, Back: -2 } as const;
const MIN_POPPABLE = 2;
interface BarState {
  items: number[];
  delegate: number;
}

/** UINavigationBar: a toolbar-styled bar showing the top item's title and buttons. */
export class NavigationBars {
  private readonly bars = new Map<number, BarState>();
  constructor(
    private readonly host: NavigationHost,
    private readonly items: NavigationItems,
    /** Lets a navigation controller handle the back button; false when the bar pops itself. */
    private readonly popRequested: (bar: number) => Promise<boolean>,
  ) {}
  get(bar: number): BarState {
    let state = this.bars.get(bar);
    if (!state) {
      state = { items: [], delegate: 0 };
      this.bars.set(bar, state);
    }
    return state;
  }
  async setItems(bar: number, items: readonly number[]): Promise<void> {
    const state = this.get(bar),
      previous = state.items;
    state.items = items.map((item) => this.host.retain(item));
    for (const item of previous) await this.host.release(item);
    await this.render(bar);
  }
  async itemChanged(item: number): Promise<void> {
    for (const [bar, state] of this.bars) if (state.items.includes(item)) await this.render(bar);
  }
  private async barItem(selector: string, args: number[]): Promise<number> {
    const pointer = this.host.alloc(this.host.classNamed(NavigationClass.BarItem));
    return this.host.autorelease(objectResult(await this.host.send(pointer, selector, args)));
  }
  private async backItem(bar: number, previous: number): Promise<number> {
    const custom = this.items.object(previous, "backBarButtonItem");
    const title = custom
      ? objectResult(await this.host.send(custom, "title"))
      : this.items.object(previous, "title");
    return this.barItem("initWithTitle:style:target:action:", [
      title || this.host.string(BACK_TITLE),
      BarItemStyle.Bordered,
      bar,
      this.host.selector("popNavigationItemAnimated:"),
    ]);
  }
  private async render(bar: number): Promise<void> {
    const { items } = this.get(bar),
      top = items.at(Position.Top),
      previous = items.at(Position.Back);
    const values: number[] = [];
    if (top) {
      const flexible = () =>
        this.barItem("initWithBarButtonSystemItem:target:action:", [
          BarSystemItem.FlexibleSpace,
          0,
          0,
        ]);
      const left =
        this.items.object(top, "leftBarButtonItem") ||
        (previous && !this.items.get(top).hidesBackButton ? await this.backItem(bar, previous) : 0);
      if (left) values.push(left);
      const view = this.items.object(top, "titleView");
      values.push(
        await flexible(),
        view
          ? await this.barItem("initWithCustomView:", [view])
          : await this.barItem("initWithTitle:style:target:action:", [
              this.items.object(top, "title"),
              BarItemStyle.Plain,
              0,
              0,
            ]),
        await flexible(),
      );
      const right = this.items.object(top, "rightBarButtonItem");
      if (right) values.push(right);
    }
    await this.host.bars.setItems(bar, this.host.array(values));
  }
  install(): void {
    this.host.hostClass(CLASS, NavigationClass.View);
    this.host.bars.adopt(CLASS, async (self) => {
      const state = this.bars.get(self);
      this.bars.delete(self);
      for (const item of state?.items ?? []) await this.host.release(item);
    });
    const host = this.host;
    host.method(CLASS, false, "items", (self) => host.array(this.get(self).items));
    host.method(CLASS, false, "setItems:animated:", (self, args) =>
      this.setItems(self, host.elements(args(Argument.First))),
    );
    host.method(CLASS, false, "topItem", (self) => this.get(self).items.at(Position.Top) ?? 0);
    host.method(CLASS, false, "backItem", (self) => this.get(self).items.at(Position.Back) ?? 0);
    host.method(CLASS, false, "delegate", (self) => this.get(self).delegate);
    host.method(CLASS, false, "setDelegate:", (self, args) => {
      this.get(self).delegate = args(Argument.First);
    });
    host.method(CLASS, false, "pushNavigationItem:animated:", (self, args) =>
      this.setItems(self, [...this.get(self).items, args(Argument.First)]),
    );
    host.method(CLASS, false, "popNavigationItemAnimated:", async (self) => {
      const top = this.get(self).items.at(Position.Top) ?? 0;
      if (this.get(self).items.length < MIN_POPPABLE) return 0;
      if (await this.popRequested(self)) return top;
      host.retain(top);
      await this.setItems(self, this.get(self).items.slice(0, -1));
      return host.autorelease(top);
    });
  }
}
