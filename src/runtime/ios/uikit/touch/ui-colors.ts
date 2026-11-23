import { DataField } from "../../foundation/data";
import { installColors } from "../colors";
import { installNibViews } from "../nib/views";
import type { TouchUiHost } from "./ui-host";
import type { UiContext } from "./context";
import { classPointer } from "./context";
import { requireCoreGraphics } from "./helpers";

const GRAY_COMPONENTS = 2;

export function installUiColors(ctx: UiContext, uiHost: TouchUiHost): void {
  const { services, getCoreGraphics, collections, lookup, read, readBytes, names } = ctx;
  services.uiColors.set(
    installColors({
      ...uiHost,
      deallocateObject: ctx.deallocObject,
      setColor: (channels, fill, stroke) => getCoreGraphics()?.setColor(channels, fill, stroke),
      createCG: async (channels, gray) => {
        const graphics = getCoreGraphics();
        if (!graphics) throw new Error("Quartz color registry unavailable");
        const [red, , , alpha] = channels;
        return graphics.colors.generic(gray ? [red, alpha] : channels);
      },
      colorInfo: (pointer) => {
        const graphics = getCoreGraphics();
        const channels = graphics?.colors.rgba(pointer);
        const color = graphics?.colors.get(pointer);
        return color && channels
          ? { channels, gray: color.components.length === GRAY_COMPONENTS }
          : undefined;
      },
      releaseCG: async (pointer) => {
        await requireCoreGraphics(ctx).release(pointer);
      },
    }),
  );
  installNibViews({
    ...uiHost,
    items: collections.items,
    classNamed: (name) => classPointer(names, name),
    isString: (pointer) => !!lookup(read(pointer), "UTF8String"),
    bytes: (pointer) =>
      readBytes(read(pointer + DataField.Bytes), read(pointer + DataField.Length)),
  });
}
