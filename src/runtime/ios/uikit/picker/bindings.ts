import { Argument } from "../../objc/host";
import { GeometryField, WORD_BYTES, floatBits, floatFromBits } from "../../abi/scalars";
import { structureMethod } from "../host";
import { PICKER_CLASS, PickerDefaults } from "./types";
import type { PickerHost } from "./types";
import { Pickers } from "./model";
import { drawPicker } from "./drawing";
function properties(host: PickerHost, pickers: Pickers): void {
  for (const [getter, setter, field] of [
    ["delegate", "setDelegate:", "delegate"],
    ["dataSource", "setDataSource:", "source"],
  ] as const) {
    host.method(PICKER_CLASS, false, getter, (self) => pickers.get(self)[field]);
    host.method(PICKER_CLASS, false, setter, (self, args) => {
      pickers.get(self)[field] = args(0);
      pickers.invalidate(self);
    });
  }
  host.method(PICKER_CLASS, false, "showsSelectionIndicator", (self) =>
    Number(pickers.get(self).indicator),
  );
  host.method(PICKER_CLASS, false, "setShowsSelectionIndicator:", (self, args) => {
    pickers.get(self).indicator = Boolean(args(0));
    pickers.changed(self);
  });
}
function queries(host: PickerHost, pickers: Pickers): void {
  host.method(PICKER_CLASS, false, "numberOfComponents", async (self) => {
    await pickers.load(self);
    return pickers.get(self).components.length;
  });
  host.method(PICKER_CLASS, false, "numberOfRowsInComponent:", async (self, args) => {
    const component = args(0);
    await pickers.load(self);
    return pickers.get(self).components[component]?.rows ?? 0;
  });
  host.method(PICKER_CLASS, false, "selectedRowInComponent:", async (self, args) => {
    const component = args(0);
    await pickers.load(self);
    return pickers.get(self).components[component]?.selected ?? -1;
  });
  host.method(PICKER_CLASS, false, "reloadAllComponents", async (self) => {
    pickers.invalidate(self);
    await pickers.load(self);
  });
  host.method(PICKER_CLASS, false, "reloadComponent:", async (self, args) => {
    const component = args(0);
    await pickers.load(self, component);
    pickers.changed(self);
  });
  host.method(PICKER_CLASS, false, "selectRow:inComponent:animated:", (self, args) =>
    pickers.select(self, args(0), args(1)),
  );
}
function dimensions(host: PickerHost, pickers: Pickers): void {
  host.structure(
    PICKER_CLASS,
    false,
    "rowSizeForComponent:",
    structureMethod(async (self, args, destination) => {
      const index = args(0);
      await pickers.load(self);
      const component = pickers.get(self).components[index];
      host.write(destination, floatBits(component?.width ?? 0));
      host.write(destination + WORD_BYTES, floatBits(component?.height ?? 0));
    }),
  );
  host.structure(
    PICKER_CLASS,
    false,
    "sizeThatFits:",
    structureMethod((self, args, destination) => {
      const width =
        floatFromBits(args(0)) || host.view(self).bounds[GeometryField.Width] || host.screenWidth();
      host.write(destination, floatBits(width));
      host.write(destination + WORD_BYTES, floatBits(PickerDefaults.Height));
    }),
  );
}
export function installPickers(host: PickerHost): {
  has(pointer: number): boolean;
  draw(pointer: number, context: CanvasRenderingContext2D): Promise<void>;
  close(): void;
} {
  host.hostClass(PICKER_CLASS, "UIView");
  const pickers = new Pickers(host);
  host.method(PICKER_CLASS, false, "init", (self) => {
    pickers.get(self);
    return host.setFrame(self, [0, 0, host.screenWidth(), PickerDefaults.Height]);
  });
  host.method(PICKER_CLASS, false, "initWithFrame:", (self, args) => {
    pickers.get(self);
    return host.setFrame(self, [
      floatFromBits(args(GeometryField.X)),
      floatFromBits(args(GeometryField.Y)),
      floatFromBits(args(GeometryField.Width)) || host.screenWidth(),
      floatFromBits(args(GeometryField.Height)) || PickerDefaults.Height,
    ]);
  });
  properties(host, pickers);
  queries(host, pickers);
  dimensions(host, pickers);
  host.method(PICKER_CLASS, false, "viewForRow:forComponent:", (self) => {
    if (
      host.responds(pickers.get(self).delegate, "pickerView:viewForRow:forComponent:reusingView:")
    )
      throw new Error("UIPickerView custom row views are not implemented.");
    return 0;
  });
  host.method(PICKER_CLASS, false, "layoutSubviews", (self) => {
    pickers.invalidate(self);
  });
  host.method(PICKER_CLASS, false, "dealloc", (self) => pickers.destroy(self));
  for (const [selector, phase] of [
    ["touchesBegan:withEvent:", "begin"],
    ["touchesMoved:withEvent:", "move"],
    ["touchesEnded:withEvent:", "end"],
    ["touchesCancelled:withEvent:", "cancel"],
  ] as const) {
    host.method(PICKER_CLASS, false, selector, (self, args) =>
      pickers.touch(self, phase, args(Argument.First)),
    );
  }
  return {
    has: (pointer) => pickers.has(pointer),
    draw: (pointer, context) => drawPicker(pickers, pointer, context),
    close: () => pickers.clear(),
  };
}
