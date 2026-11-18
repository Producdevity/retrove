import { Argument } from "../objc/host";
import { GeometryField, floatFromBits } from "../abi/scalars";
import { defaultFont, type Fonts } from "./fonts";
import type { Labels, OwnedLabelField } from "./label-state";
import { LineBreak } from "./text-layout";
import type { UIKitHost } from "./host";

const CLASS = "UITextView";
const SUPERCLASS = "UIScrollView";
/** UITextView's default font is 12-point Helvetica. */
const TEXT_VIEW_FONT_SIZE = 12;
interface TextViewState {
  editable: boolean;
  delegate: number;
  detectors: number;
  keyboard: number;
  returnKey: number;
}

interface TextViews {
  state(self: number): TextViewState;
  prepare(self: number): Promise<void>;
  forget(self: number): void;
}
function textViewStates(host: UIKitHost, labels: Labels, fonts: Fonts): TextViews {
  const states = new Map<number, TextViewState>();
  const state = (self: number): TextViewState => {
    let value = states.get(self);
    if (!value) {
      value = { editable: true, delegate: 0, detectors: 0, keyboard: 0, returnKey: 0 };
      states.set(self, value);
      const label = labels.get(self);
      label.lines = 0;
      label.mode = LineBreak.Word;
      host.view(self).interactive = true;
    }
    return value;
  };
  return {
    state,
    prepare: async (self) => {
      if (states.has(self)) return;
      state(self);
      await labels.replace(
        self,
        "font",
        fonts.create({ ...defaultFont, size: TEXT_VIEW_FONT_SIZE }),
      );
    },
    forget: (self) => void states.delete(self),
  };
}

function installTextProperties(host: UIKitHost, labels: Labels, views: TextViews): void {
  for (const [getter, setter, field] of [
    ["text", "setText:", "text"],
    ["font", "setFont:", "font"],
    ["textColor", "setTextColor:", "color"],
  ] as const satisfies readonly (readonly [string, string, OwnedLabelField])[]) {
    host.method(CLASS, false, getter, (self) => labels.get(self)[field]);
    host.method(CLASS, false, setter, async (self, args) => {
      await views.prepare(self);
      await labels.replace(self, field, args(Argument.First));
    });
  }
  host.method(CLASS, false, "textAlignment", (self) => labels.get(self).alignment);
  host.method(CLASS, false, "setTextAlignment:", async (self, args) => {
    await views.prepare(self);
    labels.get(self).alignment = args(Argument.First);
    labels.changed(self);
  });
  host.method(CLASS, false, "isEditable", (self) => Number(views.state(self).editable));
  host.method(CLASS, false, "setEditable:", (self, args) => {
    views.state(self).editable = Boolean(args(Argument.First));
  });
  for (const [getter, setter, field] of [
    ["delegate", "setDelegate:", "delegate"],
    ["dataDetectorTypes", "setDataDetectorTypes:", "detectors"],
    ["keyboardType", "setKeyboardType:", "keyboard"],
    ["returnKeyType", "setReturnKeyType:", "returnKey"],
  ] as const) {
    host.method(CLASS, false, getter, (self) => views.state(self)[field]);
    host.method(CLASS, false, setter, (self, args) => {
      views.state(self)[field] = args(Argument.First);
    });
  }
  host.method(CLASS, false, "detectsPhoneNumbers", (self) =>
    Number(views.state(self).detectors !== 0),
  );
  host.method(CLASS, false, "setDetectsPhoneNumbers:", (self, args) => {
    views.state(self).detectors = args(Argument.First) ? 1 : 0;
  });
  host.method(CLASS, false, "hasText", (self) => {
    const text = labels.get(self).text;
    return Number(Boolean(text) && host.text(text).length > 0);
  });
}

/**
 * UITextView as multi-line, word-wrapped text drawn like a label. Editing is not
 * offered yet: it never becomes first responder, so no keyboard appears.
 */
export function installTextViews(
  host: UIKitHost,
  labels: Labels,
  fonts: Fonts,
  scrollDealloc: (self: number) => unknown,
): void {
  host.hostClass(CLASS, SUPERCLASS);
  const views = textViewStates(host, labels, fonts);
  host.method(CLASS, false, "init", async (self) => {
    await host.send(self, "initWithFrame:", [0, 0, 0, 0]);
    return self;
  });
  host.method(CLASS, false, "initWithFrame:", async (self, args) => {
    await views.prepare(self);
    return host.setFrame(self, [
      floatFromBits(args(GeometryField.X)),
      floatFromBits(args(GeometryField.Y)),
      floatFromBits(args(GeometryField.Width)),
      floatFromBits(args(GeometryField.Height)),
    ]);
  });
  installTextProperties(host, labels, views);
  host.method(CLASS, false, "scrollRangeToVisible:", () => undefined);
  host.method(CLASS, false, "canBecomeFirstResponder", () => 0);
  host.method(CLASS, false, "becomeFirstResponder", () => 0);
  host.method(CLASS, false, "isFirstResponder", () => 0);
  host.method(CLASS, false, "resignFirstResponder", () => 1);
  host.method(CLASS, false, "dealloc", async (self) => {
    views.forget(self);
    await labels.release(self);
    await scrollDealloc(self);
  });
}
