import { GeometryField, floatBits, floatFromBits } from "../../abi/scalars";
import { SYSTEM_FONT_SIZE } from "../fonts";
import { objectResult } from "../host";
import { FieldEditors } from "./editor";
import { CLASS, TextFields, type TextFieldHost } from "./state";
interface Host extends TextFieldHost {
  classNamed(name: string): number;
}
export function installTextFields(host: Host) {
  host.hostClass(CLASS, "UIControl");
  const fields = new TextFields(host),
    editors = new FieldEditors(fields);
  host.method(CLASS, false, "init", (self) => {
    fields.get(self);
    return self;
  });
  host.method(CLASS, false, "initWithFrame:", (self, args) => {
    fields.get(self);
    return host.setFrame(self, [
      floatFromBits(args(GeometryField.X)),
      floatFromBits(args(GeometryField.Y)),
      floatFromBits(args(GeometryField.Width)),
      floatFromBits(args(GeometryField.Height)),
    ]);
  });
  installProperties(host, fields);
  host.method(CLASS, false, "isEditing", (self) => Number(fields.get(self).editing));
  host.method(CLASS, false, "canBecomeFirstResponder", (self) => Number(host.enabled(self)));
  host.method(CLASS, false, "becomeFirstResponder", (self) => {
    if (!host.enabled(self)) return 0;
    editors.render();
    const node = editors.node(self);
    node?.focus();
    return Number(Boolean(node) && host.document?.activeElement === node);
  });
  host.method(CLASS, false, "resignFirstResponder", (self) => {
    editors.node(self)?.blur();
    return 1;
  });
  host.method(CLASS, false, "isFirstResponder", (self) =>
    Number(Boolean(editors.node(self)) && host.document?.activeElement === editors.node(self)),
  );
  host.method(CLASS, false, "dealloc", async (self) => {
    editors.remove(self);
    await fields.destroy(self);
  });
  return {
    pump: async () => {
      await editors.pump();
      editors.render();
    },
    close: () => editors.close(),
  };
}

function installProperties(host: Host, fields: TextFields): void {
  for (const [getter, setter, key] of [
    ["text", "setText:", "text"],
    ["placeholder", "setPlaceholder:", "placeholder"],
  ] as const) {
    host.method(CLASS, false, getter, (self) => host.string(fields.get(self)[key]));
    host.method(CLASS, false, setter, (self, args) => {
      fields.get(self)[key] = args(0) ? host.text(args(0)) : "";
    });
  }
  for (const [getter, setter, key] of [
    ["textAlignment", "setTextAlignment:", "alignment"],
    ["borderStyle", "setBorderStyle:", "border"],
    ["keyboardType", "setKeyboardType:", "keyboard"],
    ["returnKeyType", "setReturnKeyType:", "returnKey"],
    ["autocorrectionType", "setAutocorrectionType:", "autocorrection"],
    ["autocapitalizationType", "setAutocapitalizationType:", "capitalization"],
    ["delegate", "setDelegate:", "delegate"],
  ] as const) {
    host.method(CLASS, false, getter, (self) => fields.get(self)[key]);
    host.method(CLASS, false, setter, (self, args) => {
      fields.get(self)[key] = args(0);
    });
  }
  for (const [getter, setter, key] of [
    ["isSecureTextEntry", "setSecureTextEntry:", "secure"],
    ["clearsOnBeginEditing", "setClearsOnBeginEditing:", "clearsOnBegin"],
    ["enablesReturnKeyAutomatically", "setEnablesReturnKeyAutomatically:", "automaticReturn"],
  ] as const) {
    host.method(CLASS, false, getter, (self) => Number(fields.get(self)[key]));
    host.method(CLASS, false, setter, (self, args) => {
      fields.get(self)[key] = Boolean(args(0));
    });
  }
  host.method(CLASS, false, "textColor", async (self) => {
    if (!fields.get(self).color)
      await fields.replace(
        self,
        "color",
        objectResult(await host.send(host.classNamed("UIColor"), "blackColor")),
      );
    return fields.get(self).color;
  });
  host.method(CLASS, false, "setTextColor:", (self, args) =>
    fields.replace(self, "color", args(0)),
  );
  host.method(CLASS, false, "setFont:", (self, args) => fields.replace(self, "font", args(0)));
  host.method(CLASS, false, "font", async (self) => {
    if (!fields.get(self).font)
      await fields.replace(
        self,
        "font",
        objectResult(
          await host.send(host.classNamed("UIFont"), "systemFontOfSize:", [
            floatBits(SYSTEM_FONT_SIZE),
          ]),
        ),
      );
    return fields.get(self).font;
  });
}
