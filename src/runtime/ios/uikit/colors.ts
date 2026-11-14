import { Argument } from "../objc/host";
import { WORD_BYTES, floatBits, floatFromBits } from "../abi/scalars";
import type { UIKitHost } from "./host";
import {
  ColorComponent as Component,
  COLOR_COMPONENTS,
  type RGBA,
} from "../../graphics/core-graphics/colors/model";
export type { RGBA } from "../../graphics/core-graphics/colors/model";
const COLOR_CLASS = "UIColor";
const COLOR_INSTANCE_BYTES = (COLOR_COMPONENTS + 1) * WORD_BYTES;
const PALETTE = {
  blackColor: [0, 0, 0, 1],
  whiteColor: [1, 1, 1, 1],
  redColor: [1, 0, 0, 1],
  greenColor: [0, 1, 0, 1],
  blueColor: [0, 0, 1, 1],
  cyanColor: [0, 1, 1, 1],
  yellowColor: [1, 1, 0, 1],
  magentaColor: [1, 0, 1, 1],
  clearColor: [0, 0, 0, 0],
  darkTextColor: [0, 0, 0, 1],
} satisfies Record<string, RGBA>;
interface ColorHost extends UIKitHost {
  setColor(channels: RGBA, fill: boolean, stroke: boolean): void;
  createCG(channels: RGBA, gray: boolean): Promise<number>;
  colorInfo(pointer: number): { channels: RGBA; gray: boolean } | undefined;
  releaseCG(pointer: number): Promise<void>;
  deallocateObject(pointer: number): Promise<void>;
}
class UIKitColors {
  readonly klass: number;
  readonly gray = new Set<number>();
  readonly native = new Map<number, number>();
  constructor(readonly host: ColorHost) {
    this.klass = host.hostClass(COLOR_CLASS, "NSObject", COLOR_INSTANCE_BYTES);
  }
  create(channels: RGBA, gray = false): number {
    const self = this.host.alloc(this.klass);
    this.store(self, channels, gray);
    return this.host.autorelease(self);
  }
  store(self: number, channels: RGBA, gray: boolean): void {
    channels.forEach((value, index) =>
      this.host.write(self + (index + 1) * WORD_BYTES, floatBits(value)),
    );
    if (gray) this.gray.add(self);
    else this.gray.delete(self);
  }
  rgba(pointer: number): RGBA {
    const channel = (index: number) =>
      floatFromBits(this.host.read(pointer + (index + 1) * WORD_BYTES));
    return [
      channel(Component.Red),
      channel(Component.Green),
      channel(Component.Blue),
      channel(Component.Alpha),
    ];
  }
  async clear(self: number): Promise<void> {
    const color = this.native.get(self);
    this.native.delete(self);
    if (color) await this.host.releaseCG(color);
  }
  async initialize(self: number, channels: RGBA, gray: boolean): Promise<number> {
    await this.clear(self);
    this.store(self, channels, gray);
    return self;
  }
  async cgColor(self: number): Promise<number> {
    const existing = this.native.get(self);
    if (existing) return existing;
    const color = await this.host.createCG(this.rgba(self), this.gray.has(self));
    if (color) this.native.set(self, color);
    return color;
  }
  async destroy(self: number): Promise<void> {
    await this.clear(self);
    this.gray.delete(self);
    await this.host.deallocateObject(self);
  }
}
export function installColors(host: ColorHost) {
  const colors = new UIKitColors(host);
  for (const [name, channels] of Object.entries(PALETTE))
    host.method(COLOR_CLASS, true, name, () => colors.create(channels));
  const rgba = (args: (index: number) => number): RGBA => [
    floatFromBits(args(Component.Red)),
    floatFromBits(args(Component.Green)),
    floatFromBits(args(Component.Blue)),
    floatFromBits(args(Component.Alpha)),
  ];
  const gray = (args: (index: number) => number): RGBA => {
    const white = floatFromBits(args(Argument.First));
    return [white, white, white, floatFromBits(args(Argument.Second))];
  };
  host.method(COLOR_CLASS, false, "initWithRed:green:blue:alpha:", (self, args) =>
    colors.initialize(self, rgba(args), false),
  );
  host.method(COLOR_CLASS, false, "initWithWhite:alpha:", (self, args) =>
    colors.initialize(self, gray(args), true),
  );
  host.method(COLOR_CLASS, true, "colorWithWhite:alpha:", (_, args) =>
    colors.create(gray(args), true),
  );
  host.method(COLOR_CLASS, true, "colorWithRed:green:blue:alpha:", (_, args) =>
    colors.create(rgba(args)),
  );
  for (const [selector, initializing] of [
    ["colorWithCGColor:", false],
    ["initWithCGColor:", true],
  ] as const)
    host.method(COLOR_CLASS, !initializing, selector, (self, args) => {
      const value = host.colorInfo(args(0));
      if (!value) return 0;
      return initializing
        ? colors.initialize(self, value.channels, value.gray)
        : colors.create(value.channels, value.gray);
    });
  host.method(COLOR_CLASS, false, "colorWithAlphaComponent:", (self, args) => {
    const channels = colors.rgba(self);
    channels[Component.Alpha] = floatFromBits(args(Argument.First));
    return colors.create(channels, colors.gray.has(self));
  });
  host.method(COLOR_CLASS, false, "CGColor", (self) => colors.cgColor(self));
  host.method(COLOR_CLASS, false, "dealloc", (self) => colors.destroy(self));
  for (const name of ["copy", "copyWithZone:"])
    host.method(COLOR_CLASS, false, name, (self) => host.retain(self));
  for (const mode of ["set", "setFill", "setStroke"])
    host.method(COLOR_CLASS, false, mode, (self) =>
      host.setColor(colors.rgba(self), mode !== "setStroke", mode !== "setFill"),
    );
  return colors;
}
