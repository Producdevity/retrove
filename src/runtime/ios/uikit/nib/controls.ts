import { floatBits, floatFromBits } from "../../abi/scalars";
import { objectResult, type UIKitHost } from "../host";

export interface NibControlHost extends UIKitHost {
  classNamed(name: string): number;
}
type DecodeView = (self: number, coder: number) => Promise<number>;
/** UIFontDescriptorTraitBold. */
const BOLD_TRAIT = 2;
const LABEL_OBJECTS = [
  ["UIText", "setText:"],
  ["UIFont", "setFont:"],
  ["UITextColor", "setTextColor:"],
  ["UIHighlightedColor", "setHighlightedTextColor:"],
  ["UIShadowColor", "setShadowColor:"],
] as const;
const LABEL_INTEGERS = [
  ["UITextAlignment", "setTextAlignment:"],
  ["UINumberOfLines", "setNumberOfLines:"],
  ["UILineBreakMode", "setLineBreakMode:"],
  ["UIAdjustsFontSizeToFit", "setAdjustsFontSizeToFitWidth:"],
] as const;

class Coder {
  constructor(
    private readonly host: NibControlHost,
    private readonly coder: number,
  ) {}
  async has(key: string): Promise<boolean> {
    return Boolean(
      await this.host.send(this.coder, "containsValueForKey:", [this.host.string(key)]),
    );
  }
  async object(key: string): Promise<number> {
    return objectResult(
      await this.host.send(this.coder, "decodeObjectForKey:", [this.host.string(key)]),
    );
  }
  async integer(key: string): Promise<number | undefined> {
    if (!(await this.has(key))) return undefined;
    return objectResult(
      await this.host.send(this.coder, "decodeIntegerForKey:", [this.host.string(key)]),
    );
  }
  async float(key: string): Promise<number | undefined> {
    if (!(await this.has(key))) return undefined;
    return floatFromBits(
      objectResult(await this.host.send(this.coder, "decodeFloatForKey:", [this.host.string(key)])),
    );
  }
}

async function decodeFont(host: NibControlHost, self: number, coder: Coder): Promise<number> {
  const size = (await coder.float("UIFontPointSize")) ?? 0,
    name = await coder.object("UIFontName"),
    system = Boolean(await coder.integer("UISystemFont")),
    bold = ((await coder.integer("UIFontTraits")) ?? 0) & BOLD_TRAIT,
    klass = host.classNamed("UIFont");
  const font = objectResult(
    !system && name
      ? await host.send(klass, "fontWithName:size:", [name, floatBits(size)])
      : await host.send(klass, bold ? "boldSystemFontOfSize:" : "systemFontOfSize:", [
          floatBits(size),
        ]),
  );
  host.destroy(self);
  return font ? host.retain(font) : 0;
}

/** UIButtonContent keys and the UIButton setters for one control state. */
const BUTTON_CONTENT = [
  ["UITitle", "setTitle:forState:"],
  ["UITitleColor", "setTitleColor:forState:"],
  ["UIImage", "setImage:forState:"],
  ["UIBackgroundImage", "setBackgroundImage:forState:"],
] as const;
const BUTTON_CONTENT_CLASS = "UIButtonContent";

/** UIButton nibs keep per-state titles and images as UIButtonContent keyed by control state. */
function installNibButtons(host: NibControlHost, decodeView: DecodeView): void {
  host.hostClass(BUTTON_CONTENT_CLASS, "NSObject");
  const contents = new Map<number, Map<string, number>>();
  host.method(BUTTON_CONTENT_CLASS, false, "initWithCoder:", async (self, args) => {
    const coder = new Coder(host, args(0)),
      fields = new Map<string, number>();
    for (const [key] of BUTTON_CONTENT) {
      const value = await coder.object(key);
      if (value) fields.set(key, host.retain(value));
    }
    contents.set(self, fields);
    return self;
  });
  host.method(BUTTON_CONTENT_CLASS, false, "dealloc", async (self) => {
    for (const value of contents.get(self)?.values() ?? []) await host.release(value);
    contents.delete(self);
    host.destroy(self);
  });
  host.method("UIButton", false, "initWithCoder:", async (self, args) => {
    const coder = new Coder(host, args(0));
    await decodeView(self, args(0));
    const font = await coder.object("UIFont");
    if (font)
      await host.send(objectResult(await host.send(self, "titleLabel")), "setFont:", [font]);
    const states = await coder.object("UIButtonStatefulContent");
    if (!states) return self;
    const keys = objectResult(await host.send(states, "allKeys"));
    const count = objectResult(await host.send(keys, "count"));
    for (let index = 0; index < count; index++) {
      const key = objectResult(await host.send(keys, "objectAtIndex:", [index]));
      const state = objectResult(await host.send(key, "unsignedIntValue"));
      const content = contents.get(objectResult(await host.send(states, "objectForKey:", [key])));
      for (const [field, setter] of BUTTON_CONTENT) {
        const value = content?.get(field);
        if (value) await host.send(self, setter, [value, state]);
      }
    }
    return self;
  });
}

/** Keyed-archive decoding for UILabel, UIFont, UIImage, UIImageView and UIButton. */
export function installNibControls(host: NibControlHost, decodeView: DecodeView): void {
  host.method("UILabel", false, "initWithCoder:", async (self, args) => {
    const coder = new Coder(host, args(0));
    await decodeView(self, args(0));
    for (const [key, setter] of LABEL_OBJECTS) {
      const value = await coder.object(key);
      if (value) await host.send(self, setter, [value]);
    }
    for (const [key, setter] of LABEL_INTEGERS) {
      const value = await coder.integer(key);
      if (value !== undefined) await host.send(self, setter, [value]);
    }
    const minimum = await coder.float("UIMinimumFontSize");
    if (minimum !== undefined) await host.send(self, "setMinimumFontSize:", [floatBits(minimum)]);
    return self;
  });
  host.method("UIFont", false, "initWithCoder:", (self, args) =>
    decodeFont(host, self, new Coder(host, args(0))),
  );
  host.method("UIImage", false, "initWithCoder:", async (self, args) => {
    const name = await new Coder(host, args(0)).object("UIResourceName"),
      image = name
        ? objectResult(await host.send(host.classNamed("UIImage"), "imageNamed:", [name]))
        : 0;
    host.destroy(self);
    return image ? host.retain(image) : 0;
  });
  installNibButtons(host, decodeView);
  host.method("UIImageView", false, "initWithCoder:", async (self, args) => {
    const coder = new Coder(host, args(0));
    await decodeView(self, args(0));
    for (const [key, setter] of [
      ["UIImage", "setImage:"],
      ["UIHighlightedImage", "setHighlightedImage:"],
    ] as const) {
      const image = await coder.object(key);
      if (image) await host.send(self, setter, [image]);
    }
    return self;
  });
}
