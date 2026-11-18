import { Argument } from "../../objc/host";
import { NavigationClass, type NavigationHost } from "./host";

const CLASS = NavigationClass.Item;
const OBJECT_FIELDS = [
  ["title", "setTitle:"],
  ["titleView", "setTitleView:"],
  ["leftBarButtonItem", "setLeftBarButtonItem:"],
  ["rightBarButtonItem", "setRightBarButtonItem:"],
  ["backBarButtonItem", "setBackBarButtonItem:"],
  ["prompt", "setPrompt:"],
] as const;
export type ItemField = (typeof OBJECT_FIELDS)[number][0];
export interface NavigationItem {
  readonly objects: Map<ItemField, number>;
  hidesBackButton: boolean;
}

/** UINavigationItem: the title and bar buttons a navigation bar shows for one level. */
export class NavigationItems {
  private readonly items = new Map<number, NavigationItem>();
  constructor(
    private readonly host: NavigationHost,
    private readonly changed: (item: number) => Promise<void>,
  ) {}
  get(self: number): NavigationItem {
    let item = this.items.get(self);
    if (!item) {
      item = { objects: new Map(), hidesBackButton: false };
      this.items.set(self, item);
    }
    return item;
  }
  object(self: number, field: ItemField): number {
    return this.items.get(self)?.objects.get(field) ?? 0;
  }
  async set(self: number, field: ItemField, value: number): Promise<void> {
    const objects = this.get(self).objects,
      previous = objects.get(field) ?? 0;
    if (previous === value) return;
    const next =
      value && (field === "title" || field === "prompt")
        ? ((await this.host.send(value, "copy")) ?? 0)
        : this.host.retain(value);
    if (typeof next === "number" && next) objects.set(field, next);
    else objects.delete(field);
    await this.host.release(previous);
    await this.changed(self);
  }
  /** A new autoreleased item, titled `title` when given. */
  async create(title: number): Promise<number> {
    const pointer = this.host.alloc(this.host.classNamed(CLASS));
    if (title) await this.set(pointer, "title", title);
    return this.host.autorelease(pointer);
  }
  install(): void {
    this.host.hostClass(CLASS, "NSObject");
    this.host.method(CLASS, false, "initWithTitle:", async (self, args) => {
      await this.set(self, "title", args(Argument.First));
      return self;
    });
    for (const [getter, setter] of OBJECT_FIELDS) {
      this.host.method(CLASS, false, getter, (self) => this.object(self, getter));
      this.host.method(CLASS, false, setter, (self, args) =>
        this.set(self, getter, args(Argument.First)),
      );
    }
    for (const [setter, field] of [
      ["setLeftBarButtonItem:animated:", "leftBarButtonItem"],
      ["setRightBarButtonItem:animated:", "rightBarButtonItem"],
    ] as const)
      this.host.method(CLASS, false, setter, (self, args) =>
        this.set(self, field, args(Argument.First)),
      );
    this.host.method(CLASS, false, "hidesBackButton", (self) =>
      Number(this.get(self).hidesBackButton),
    );
    for (const setter of ["setHidesBackButton:", "setHidesBackButton:animated:"])
      this.host.method(CLASS, false, setter, async (self, args) => {
        this.get(self).hidesBackButton = Boolean(args(Argument.First));
        await this.changed(self);
      });
    this.host.method(CLASS, false, "dealloc", async (self) => {
      const item = this.items.get(self);
      this.items.delete(self);
      for (const pointer of item?.objects.values() ?? []) await this.host.release(pointer);
      this.host.destroy(self);
    });
  }
}
