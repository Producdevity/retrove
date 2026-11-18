import { defaultFont, type Fonts } from "./fonts";
import { LineBreak, TextAlignment } from "./text-layout";
import { objectResult, type UIKitHost } from "./host";

export interface LabelState {
  text: number;
  font: number;
  color: number;
  shadowColor: number;
  highlightedColor: number;
  highlighted: boolean;
  enabled: boolean;
  alignment: number;
  mode: LineBreak;
  lines: number;
  adjusts: boolean;
  minimumSize: number;
}
export type OwnedLabelField = "text" | "font" | "color" | "shadowColor" | "highlightedColor";
export class Labels {
  private readonly states = new Map<number, LabelState>();
  constructor(
    private readonly host: UIKitHost,
    private readonly fonts: Fonts,
  ) {}
  has(self: number): boolean {
    return this.states.has(self);
  }
  get(self: number): LabelState {
    let state = this.states.get(self);
    if (!state) {
      state = {
        text: 0,
        font: this.host.retain(this.fonts.create(defaultFont)),
        color: 0,
        shadowColor: 0,
        highlightedColor: 0,
        highlighted: false,
        enabled: true,
        alignment: TextAlignment.Left,
        mode: LineBreak.Tail,
        lines: 1,
        adjusts: false,
        minimumSize: 0,
      };
      this.states.set(self, state);
      this.host.view(self).interactive = false;
      this.changed(self);
    }
    return state;
  }
  changed(self: number): void {
    this.host.view(self).needsDisplay = true;
  }
  async replace(self: number, field: OwnedLabelField, value: number): Promise<void> {
    const state = this.get(self);
    const next =
      value && field === "text"
        ? objectResult(await this.host.send(value, "copy"))
        : this.host.retain(value);
    const previous = state[field];
    state[field] = next;
    this.changed(self);
    await this.host.release(previous);
  }
  async destroy(self: number): Promise<void> {
    await this.release(self);
    await this.host.deallocateView(self);
  }
  /** Releases the label's objects without deallocating the view. */
  async release(self: number): Promise<void> {
    const state = this.states.get(self);
    this.states.delete(self);
    if (state)
      for (const pointer of [
        state.text,
        state.font,
        state.color,
        state.shadowColor,
        state.highlightedColor,
      ])
        await this.host.release(pointer);
  }
  clear(): void {
    this.states.clear();
  }
}
