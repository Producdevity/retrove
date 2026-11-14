import { canvasFont } from "../fonts";
import { floatFromBits, WORD_BYTES } from "../../abi/scalars";
import type { TextFields } from "./state";
import { ControlEvent } from "../control-actions";
const PERCENT = 100;
const COLOR_MAX = 255;
const ROUNDED_BORDER = 3;
const MAX_BASIC_PLANE_CODE_POINT = 0xffff;
type Event = {
  readonly self: number;
  readonly kind: "begin" | "end" | "change" | "return";
  readonly text: string;
};
export class FieldEditors {
  private readonly nodes = new Map<number, HTMLInputElement>();
  private readonly events: Event[] = [];
  constructor(private readonly fields: TextFields) {}
  node(self: number): HTMLInputElement | undefined {
    let input = this.nodes.get(self);
    if (input) return input;
    const host = this.fields.host;
    if (!host.document || !host.mount) return;
    input = host.document.createElement("input");
    input.style.cssText =
      "position:absolute;box-sizing:border-box;margin:0;padding:0;min-width:0;background:transparent;transform-origin:0 0;z-index:10000";
    input.autocomplete = "off";
    for (const [name, kind] of [
      ["focus", "begin"],
      ["blur", "end"],
      ["input", "change"],
    ] as const)
      input.addEventListener(name, () => this.events.push({ self, kind, text: input.value }));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.events.push({ self, kind: "return", text: input.value });
      }
    });
    host.mount.append(input);
    this.nodes.set(self, input);
    return input;
  }
  render(): void {
    const host = this.fields.host;
    for (const [self, value] of this.fields.fields) {
      const layout = host.layout(self),
        node = this.node(self);
      if (!node) continue;
      node.hidden = !layout;
      if (!layout) continue;
      node.type = value.secure ? "password" : "text";
      node.inputMode = keyboardMode(value.keyboard);
      node.enterKeyHint = returnKey(value.returnKey);
      node.spellcheck = value.autocorrection !== 1;
      node.autocapitalize =
        ["off", "words", "sentences", "characters"][value.capitalization] ?? "off";
      node.placeholder = value.placeholder;
      node.disabled = !host.enabled(self);
      if (!this.events.some((event) => event.self === self) && node.value !== value.text)
        node.value = value.text;
      const font = host.font(value.font);
      Object.assign(node.style, layout, {
        font: canvasFont(font),
        textAlign: ["left", "center", "right"][value.alignment] ?? "left",
        border: value.border ? "1px solid #777" : "none",
        borderRadius: value.border === ROUNDED_BORDER ? "0.4em" : "0",
        color: value.color ? color((pointer) => host.read(pointer), value.color) : "black",
      });
    }
  }
  async pump(): Promise<void> {
    for (const event of this.events.splice(0)) {
      if (!this.fields.fields.has(event.self)) continue;
      const value = this.fields.get(event.self),
        node = this.nodes.get(event.self);
      if (event.kind === "change") {
        const change = textChange(value.text, event.text),
          replacement = this.fields.host.string(change.text);
        if (
          await this.fields.allow(
            event.self,
            "textField:shouldChangeCharactersInRange:replacementString:",
            [change.start, change.length, replacement],
          )
        ) {
          value.text = event.text;
          await this.fields.host.dispatch(event.self, ControlEvent.EditingChanged);
        } else if (node) node.value = value.text;
      } else if (event.kind === "return") {
        if (!value.automaticReturn || value.text.length)
          if (await this.fields.allow(event.self, "textFieldShouldReturn:"))
            await this.fields.host.dispatch(event.self, ControlEvent.EditingDidEndOnExit);
      } else {
        const begin = event.kind === "begin";
        if (
          !(await this.fields.allow(
            event.self,
            begin ? "textFieldShouldBeginEditing:" : "textFieldShouldEndEditing:",
          ))
        ) {
          if (begin) node?.blur();
          else node?.focus();
          continue;
        }
        value.editing = begin;
        if (begin && value.clearsOnBegin) {
          value.text = "";
          if (node) node.value = "";
        }
        await this.fields.notify(
          event.self,
          begin ? "textFieldDidBeginEditing:" : "textFieldDidEndEditing:",
        );
        await this.fields.host.dispatch(
          event.self,
          begin ? ControlEvent.EditingDidBegin : ControlEvent.EditingDidEnd,
        );
      }
    }
  }
  remove(self: number): void {
    this.nodes.get(self)?.remove();
    this.nodes.delete(self);
  }
  close(): void {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
    this.events.length = 0;
  }
}
export function textChange(before: string, after: string) {
  let start = 0,
    end = before.length,
    afterEnd = after.length;
  while (start < end && start < afterEnd && before[start] === after[start]) start++;
  if (splitsPair(before, start) || splitsPair(after, start)) start--;
  while (end > start && afterEnd > start && before[end - 1] === after[afterEnd - 1]) {
    end--;
    afterEnd--;
  }
  if (splitsPair(before, end) || splitsPair(after, afterEnd)) {
    end++;
    afterEnd++;
  }
  return { start, length: end - start, text: after.slice(start, afterEnd) };
}
function keyboardMode(value: number): HTMLInputElement["inputMode"] {
  const modes: Record<number, string> = {
    0: "text",
    1: "text",
    2: "url",
    3: "numeric",
    4: "tel",
    5: "tel",
    6: "email",
    7: "decimal",
    8: "text",
    9: "search",
  };
  return modes[value] ?? "text";
}
function color(read: (pointer: number) => number, pointer: number): string {
  const channels = Array.from({ length: 4 }, (_, index) =>
    floatFromBits(read(pointer + (index + 1) * WORD_BYTES)),
  );
  const [red = 0, green = 0, blue = 0, alpha = 1] = channels;
  return `rgba(${red * COLOR_MAX},${green * COLOR_MAX},${blue * COLOR_MAX},${alpha * PERCENT}%)`;
}

function returnKey(value: number): string {
  const keys: Record<number, string> = {
    0: "enter",
    1: "go",
    2: "search",
    3: "go",
    4: "next",
    5: "go",
    6: "search",
    7: "send",
    8: "search",
    9: "done",
    10: "go",
  };
  return keys[value] ?? "enter";
}

function splitsPair(value: string, at: number): boolean {
  return at > 0 && (value.codePointAt(at - 1) ?? 0) > MAX_BASIC_PLANE_CODE_POINT;
}
