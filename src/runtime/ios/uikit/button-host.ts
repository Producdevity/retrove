import { Argument } from "../objc/host";
import { floatFromBits, floatBits, GeometryField, WORD_BYTES } from "../abi/scalars";
import { CONTROL_CLASS, type Controls } from "./control-host";
import { structureMethod, objectResult } from "./host";
import { Buttons, type ButtonHost } from "./button-state";
const BUTTON_CLASS = "UIButton";
/** The fourth UIEdgeInsets float; the struct is passed by value as four words. */
const INSET_RIGHT = 3;
export function installButtons(host: ButtonHost, controls: Controls): void {
  host.hostClass(BUTTON_CLASS, CONTROL_CLASS);
  const buttons = new Buttons(host, controls);
  installImageAdjustments(host, buttons, controls);
  installInsets(host, buttons, controls);
  host.method(BUTTON_CLASS, true, "buttonWithType:", async (klass, args) => {
    const pointer = objectResult(await host.send(host.alloc(klass), "init"));
    if (!pointer) return 0;
    const state = await buttons.get(pointer);
    state.kind = args(Argument.First);
    return host.autorelease(pointer);
  });
  host.method(BUTTON_CLASS, false, "init", async (self) => {
    await buttons.get(self);
    return self;
  });
  host.method(BUTTON_CLASS, false, "initWithFrame:", async (self, args) => {
    await buttons.get(self);
    return host.setFrame(self, [
      floatFromBits(args(GeometryField.X)),
      floatFromBits(args(GeometryField.Y)),
      floatFromBits(args(GeometryField.Width)),
      floatFromBits(args(GeometryField.Height)),
    ]);
  });
  host.structure(
    BUTTON_CLASS,
    false,
    "sizeThatFits:",
    structureMethod(async (self, _args, destination) => {
      const [width, height] = await buttons.size(self);
      host.write(destination, floatBits(width));
      host.write(destination + WORD_BYTES, floatBits(height));
    }),
  );
  host.method(BUTTON_CLASS, false, "sizeToFit", async (self) => {
    const [width, height] = await buttons.size(self),
      frame = host.view(self).frame;
    host.setFrame(self, [frame[GeometryField.X], frame[GeometryField.Y], width, height]);
  });
  host.method(BUTTON_CLASS, false, "buttonType", async (self) => (await buttons.get(self)).kind);
  host.method(BUTTON_CLASS, false, "titleLabel", async (self) => (await buttons.get(self)).label);
  host.method(BUTTON_CLASS, false, "setTitleShadowOffset:", async (self, args) => {
    const { label } = await buttons.get(self);
    await host.send(label, "setShadowOffset:", [args(Argument.First), args(Argument.Second)]);
  });
  host.method(BUTTON_CLASS, false, "imageView", async (self) => (await buttons.get(self)).image);
  host.method(BUTTON_CLASS, false, "layoutSubviews", (self) => buttons.layout(self));
  host.method(BUTTON_CLASS, false, "dealloc", (self) => buttons.destroy(self));
  for (const [field, setter, getter, current] of [
    ["title", "setTitle:forState:", "titleForState:", "currentTitle"],
    ["color", "setTitleColor:forState:", "titleColorForState:", "currentTitleColor"],
    [
      "shadow",
      "setTitleShadowColor:forState:",
      "titleShadowColorForState:",
      "currentTitleShadowColor",
    ],
    ["image", "setImage:forState:", "imageForState:", "currentImage"],
    [
      "background",
      "setBackgroundImage:forState:",
      "backgroundImageForState:",
      "currentBackgroundImage",
    ],
  ] as const) {
    host.method(BUTTON_CLASS, false, setter, (self, args) =>
      buttons.replace(self, field, args(Argument.First), args(Argument.Second)),
    );
    host.method(BUTTON_CLASS, false, getter, async (self, args) =>
      buttons.appearance(await buttons.get(self), field, args(Argument.First), false),
    );
    host.method(BUTTON_CLASS, false, current, async (self) =>
      buttons.appearance(await buttons.get(self), field, controls.flags(self), true),
    );
  }
}

function installInsets(host: ButtonHost, buttons: Buttons, controls: Controls): void {
  for (const [field, name] of [
    ["content", "contentEdgeInsets"],
    ["title", "titleEdgeInsets"],
    ["image", "imageEdgeInsets"],
  ] as const) {
    const setter = `set${name.charAt(0).toUpperCase()}${name.slice(1)}:`;
    host.method(BUTTON_CLASS, false, setter, async (self, args) => {
      (await buttons.get(self)).insets[field] = [
        floatFromBits(args(Argument.First)),
        floatFromBits(args(Argument.Second)),
        floatFromBits(args(Argument.Third)),
        floatFromBits(args(INSET_RIGHT)),
      ];
      controls.changed(self);
    });
    host.structure(
      BUTTON_CLASS,
      false,
      name,
      structureMethod(async (self, _args, destination) => {
        (await buttons.get(self)).insets[field].forEach((value, index) =>
          host.write(destination + index * WORD_BYTES, floatBits(value)),
        );
      }),
    );
  }
}

function installImageAdjustments(host: ButtonHost, buttons: Buttons, controls: Controls): void {
  for (const [getter, setter, key] of [
    ["adjustsImageWhenHighlighted", "setAdjustsImageWhenHighlighted:", "adjustsHighlighted"],
    ["adjustsImageWhenDisabled", "setAdjustsImageWhenDisabled:", "adjustsDisabled"],
  ] as const) {
    host.method(BUTTON_CLASS, false, getter, async (self) =>
      Number((await buttons.get(self))[key]),
    );
    host.method(BUTTON_CLASS, false, setter, async (self, args) => {
      (await buttons.get(self))[key] = Boolean(args(Argument.First));
      controls.changed(self);
    });
  }
}
