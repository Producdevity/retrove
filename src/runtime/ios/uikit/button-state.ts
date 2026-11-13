import { objectResult, UIKitClass } from "./host";
import type { ControlHost, Controls } from "./control-host";
import { ControlState } from "./control-actions";
import { TextAlignment } from "./text-layout";

export interface Appearance {
  title: number;
  color: number;
  image: number;
  background: number;
}
export type AppearanceField = keyof Appearance;
export interface ButtonState {
  readonly label: number;
  readonly image: number;
  readonly background: number;
  readonly styles: Map<number, Appearance>;
  kind: number;
}
export class Buttons {
  private readonly states = new Map<number, Promise<ButtonState>>();
  constructor(
    private readonly host: ControlHost,
    private readonly controls: Controls,
  ) {}
  get(self: number): Promise<ButtonState> {
    let state = this.states.get(self);
    if (!state) {
      state = this.initialize(self);
      this.states.set(self, state);
    }
    return state;
  }
  private async child(self: number, name: string): Promise<number> {
    const pointer = objectResult(await this.host.send(this.host.classNamed(name), "new"));
    this.host.view(pointer).interactive = false;
    await this.host.send(self, "addSubview:", [pointer]);
    return pointer;
  }
  private async initialize(self: number): Promise<ButtonState> {
    const background = await this.child(self, "UIImageView");
    const image = await this.child(self, "UIImageView");
    const label = await this.child(self, UIKitClass.Label);
    await this.host.send(label, "setTextAlignment:", [TextAlignment.Center]);
    const white = objectResult(await this.host.send(this.host.classNamed("UIColor"), "whiteColor"));
    return {
      label,
      image,
      background,
      kind: 0,
      styles: new Map([
        [
          ControlState.Normal,
          { title: 0, color: this.host.retain(white), image: 0, background: 0 },
        ],
      ]),
    };
  }
  appearance(state: ButtonState, field: AppearanceField, flags: number, current: boolean): number {
    const exact = state.styles.get(flags)?.[field];
    if (exact) return exact;
    if (current)
      for (const flag of [ControlState.Disabled, ControlState.Highlighted, ControlState.Selected]) {
        const value = state.styles.get(flag)?.[field];
        if (flags & flag && value) return value;
      }
    return state.styles.get(ControlState.Normal)?.[field] ?? 0;
  }
  async replace(
    self: number,
    field: AppearanceField,
    pointer: number,
    flags: number,
  ): Promise<void> {
    const state = await this.get(self);
    const style = state.styles.get(flags) ?? { title: 0, color: 0, image: 0, background: 0 };
    const replacement =
      field === "title" && pointer
        ? objectResult(await this.host.send(pointer, "copy"))
        : this.host.retain(pointer);
    const previous = style[field];
    style[field] = replacement;
    state.styles.set(flags, style);
    this.controls.changed(self);
    await this.host.release(previous);
  }
  async layout(self: number): Promise<void> {
    const state = await this.get(self),
      flags = this.controls.flags(self);
    for (const [pointer, field, getter, setter] of [
      [state.label, "title", "text", "setText:"],
      [state.label, "color", "textColor", "setTextColor:"],
      [state.image, "image", "image", "setImage:"],
      [state.background, "background", "image", "setImage:"],
    ] as const) {
      const value = this.appearance(state, field, flags, true);
      if (value !== (await this.host.send(pointer, getter)))
        await this.host.send(pointer, setter, [value]);
    }
    const bounds = this.host.view(self).bounds;
    for (const pointer of [state.background, state.image, state.label])
      this.host.setFrame(pointer, [...bounds]);
  }
  async destroy(self: number): Promise<void> {
    const state = await this.states.get(self);
    this.states.delete(self);
    this.controls.remove(self);
    if (state) {
      for (const style of state.styles.values())
        for (const pointer of [style.title, style.color, style.image, style.background])
          await this.host.release(pointer);
      for (const pointer of [state.label, state.image, state.background])
        await this.host.release(pointer);
    }
    await this.host.deallocateView(self);
  }
}
