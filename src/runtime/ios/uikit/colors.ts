import { Argument } from "../objc/host";
import { WORD_BYTES, floatBits, floatFromBits } from "../abi/scalars";
import type { UIKitHost } from "./host";
export type RGBA = [number, number, number, number];
const COLOR_CLASS = "UIColor";
const COLOR_COMPONENTS = 4;
const COLOR_INSTANCE_BYTES = (COLOR_COMPONENTS + 1) * WORD_BYTES;
const Component = { Red: 0, Green: 1, Blue: 2, Alpha: 3 } as const;
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
}
export function installColors(host: ColorHost): void {
  const klass = host.hostClass(COLOR_CLASS, "NSObject", COLOR_INSTANCE_BYTES);
  const create = (channels: RGBA): number => {
    const pointer = host.alloc(klass);
    channels.forEach((channel, index) =>
      host.write(pointer + (index + 1) * WORD_BYTES, floatBits(channel)),
    );
    return host.autorelease(pointer);
  };
  const read = (pointer: number): RGBA => {
    const channel = (index: number): number =>
      floatFromBits(host.read(pointer + (index + 1) * WORD_BYTES));
    return [
      channel(Component.Red),
      channel(Component.Green),
      channel(Component.Blue),
      channel(Component.Alpha),
    ];
  };
  for (const [name, channels] of Object.entries(PALETTE))
    host.method(COLOR_CLASS, true, name, () => create(channels));
  host.method(COLOR_CLASS, true, "colorWithWhite:alpha:", (_self, args) => {
    const white = floatFromBits(args(Argument.First));
    return create([white, white, white, floatFromBits(args(Argument.Second))]);
  });
  host.method(COLOR_CLASS, true, "colorWithRed:green:blue:alpha:", (_self, args) =>
    create([
      floatFromBits(args(Component.Red)),
      floatFromBits(args(Component.Green)),
      floatFromBits(args(Component.Blue)),
      floatFromBits(args(Component.Alpha)),
    ]),
  );
  host.method(COLOR_CLASS, false, "colorWithAlphaComponent:", (self, args) => {
    const channels = read(self);
    channels[Component.Alpha] = floatFromBits(args(Argument.First));
    return create(channels);
  });
  host.method(COLOR_CLASS, false, "CGColor", (self) => self);
  for (const name of ["copy", "copyWithZone:"])
    host.method(COLOR_CLASS, false, name, (self) => host.retain(self));
  for (const mode of ["set", "setFill", "setStroke"])
    host.method(COLOR_CLASS, false, mode, (self) =>
      host.setColor(read(self), mode !== "setStroke", mode !== "setFill"),
    );
}
