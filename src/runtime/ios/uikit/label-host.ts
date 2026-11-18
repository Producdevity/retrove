import { Argument } from "../objc/host";
import { GeometryField, WORD_BYTES, floatBits, floatFromBits } from "../abi/scalars";
import { Fonts, type Font } from "./fonts";
import { LabelDrawing } from "./label-drawing";
import { Labels } from "./label-state";
import { lineBreak } from "./text-layout";
import { installStringDrawing, type CurrentContext } from "./string-drawing";
import { UIKitClass, structureMethod, type UIKitHost } from "./host";
import { installTextViews } from "./text-view";

function installProperties(host: UIKitHost, labels: Labels): void {
  for (const [getter, setter, field] of [
    ["text", "setText:", "text"],
    ["font", "setFont:", "font"],
    ["textColor", "setTextColor:", "color"],
    ["shadowColor", "setShadowColor:", "shadowColor"],
    ["highlightedTextColor", "setHighlightedTextColor:", "highlightedColor"],
  ] as const) {
    host.method(UIKitClass.Label, false, getter, (self) => labels.get(self)[field]);
    host.method(UIKitClass.Label, false, setter, (self, args) =>
      labels.replace(self, field, args(Argument.First)),
    );
  }
  for (const [getter, setter, field] of [
    ["textAlignment", "setTextAlignment:", "alignment"],
    ["numberOfLines", "setNumberOfLines:", "lines"],
  ] as const) {
    host.method(UIKitClass.Label, false, getter, (self) => labels.get(self)[field]);
    host.method(UIKitClass.Label, false, setter, (self, args) => {
      labels.get(self)[field] = args(Argument.First);
      labels.changed(self);
    });
  }
  for (const [getter, setter, field] of [
    ["adjustsFontSizeToFitWidth", "setAdjustsFontSizeToFitWidth:", "adjusts"],
    ["isHighlighted", "setHighlighted:", "highlighted"],
    ["isEnabled", "setEnabled:", "enabled"],
  ] as const) {
    host.method(UIKitClass.Label, false, getter, (self) => Number(labels.get(self)[field]));
    host.method(UIKitClass.Label, false, setter, (self, args) => {
      labels.get(self)[field] = Boolean(args(Argument.First));
      labels.changed(self);
    });
  }
  host.method(UIKitClass.Label, false, "lineBreakMode", (self) => labels.get(self).mode);
  host.method(UIKitClass.Label, false, "setLineBreakMode:", (self, args) => {
    labels.get(self).mode = lineBreak(args(Argument.First));
    labels.changed(self);
  });
  host.method(UIKitClass.Label, false, "minimumFontSize", (self) =>
    floatBits(labels.get(self).minimumSize),
  );
  host.method(UIKitClass.Label, false, "setMinimumFontSize:", (self, args) => {
    const size = floatFromBits(args(Argument.First));
    if (!Number.isFinite(size) || size < 0) throw new Error("Invalid minimum font size.");
    labels.get(self).minimumSize = size;
    labels.changed(self);
  });
}
export function installLabels(
  host: UIKitHost,
  current?: CurrentContext,
): {
  has(pointer: number): boolean;
  font(pointer: number): Font;
  size(pointer: number): [number, number];
  draw(pointer: number, context: CanvasRenderingContext2D): void;
  /** Installs UITextView once UIScrollView exists. */
  installTextViews(scrollDealloc: (self: number) => unknown): void;
  close(): void;
} {
  const fonts = new Fonts(host);
  fonts.install();
  const labels = new Labels(host, fonts);
  const drawing = new LabelDrawing(host, labels, fonts);
  host.hostClass(UIKitClass.Label, UIKitClass.View);
  host.method(UIKitClass.Label, false, "init", (self) => {
    labels.get(self);
    return self;
  });
  host.method(UIKitClass.Label, false, "initWithFrame:", (self, args) => {
    labels.get(self);
    return host.setFrame(self, [
      floatFromBits(args(GeometryField.X)),
      floatFromBits(args(GeometryField.Y)),
      floatFromBits(args(GeometryField.Width)),
      floatFromBits(args(GeometryField.Height)),
    ]);
  });
  host.method(UIKitClass.Label, false, "sizeToFit", (self) => drawing.fit(self));
  host.method(UIKitClass.Label, false, "dealloc", (self) => labels.destroy(self));
  installProperties(host, labels);
  installStringDrawing(host, fonts, (...input) => drawing.measure(...input), current);
  host.structure(
    UIKitClass.String,
    false,
    "sizeWithFont:constrainedToSize:lineBreakMode:",
    structureMethod((self, args, destination) => {
      const [width, height] = drawing.measure(
        host.text(self),
        fonts.get(args(Argument.First)),
        floatFromBits(args(Argument.Second)),
        floatFromBits(args(Argument.Third)),
        { mode: lineBreak(args(GeometryField.Height)), lines: 0 },
      );
      host.write(destination, floatBits(width));
      host.write(destination + WORD_BYTES, floatBits(height));
    }),
  );
  return {
    has: (pointer) => labels.has(pointer),
    font: (pointer: number) => fonts.get(pointer),
    size: (pointer) => drawing.size(pointer),
    draw: (pointer, context) => drawing.draw(pointer, context),
    installTextViews: (scrollDealloc) => installTextViews(host, labels, fonts, scrollDealloc),
    close: () => {
      fonts.close();
      labels.clear();
    },
  };
}
