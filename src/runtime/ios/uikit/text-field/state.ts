import type { UIKitHost } from "../host";
import type { Font } from "../fonts";
export const CLASS = "UITextField";
export interface Field {
  text: string;
  placeholder: string;
  delegate: number;
  font: number;
  color: number;
  alignment: number;
  border: number;
  keyboard: number;
  returnKey: number;
  autocorrection: number;
  capitalization: number;
  secure: boolean;
  clearsOnBegin: boolean;
  automaticReturn: boolean;
  editing: boolean;
}
export interface TextFieldHost extends UIKitHost {
  readonly mount?: HTMLElement;
  selector(value: string): number;
  font(pointer: number): Font;
  layout(pointer: number): Partial<CSSStyleDeclaration> | undefined;
  enabled(pointer: number): boolean;
  dispatch(pointer: number, events: number): Promise<void>;
}
export class TextFields {
  readonly fields = new Map<number, Field>();
  constructor(readonly host: TextFieldHost) {}
  get(self: number): Field {
    let value = this.fields.get(self);
    if (!value) {
      value = {
        text: "",
        placeholder: "",
        delegate: 0,
        font: 0,
        color: 0,
        alignment: 0,
        border: 0,
        keyboard: 0,
        returnKey: 0,
        autocorrection: 0,
        capitalization: 0,
        secure: false,
        clearsOnBegin: false,
        automaticReturn: false,
        editing: false,
      };
      this.fields.set(self, value);
    }
    return value;
  }
  async allow(self: number, selector: string, args: number[] = []): Promise<boolean> {
    const delegate = this.get(self).delegate;
    if (
      !delegate ||
      !(await this.host.send(delegate, "respondsToSelector:", [this.host.selector(selector)]))
    )
      return true;
    return Boolean(await this.host.send(delegate, selector, [self, ...args]));
  }
  async notify(self: number, selector: string): Promise<void> {
    const delegate = this.get(self).delegate;
    if (delegate) await this.host.send(delegate, selector, [self], true);
  }
  async replace(self: number, key: "font" | "color", pointer: number): Promise<void> {
    const value = this.get(self),
      old = value[key];
    value[key] = this.host.retain(pointer);
    await this.host.release(old);
  }
  async destroy(self: number): Promise<void> {
    const value = this.fields.get(self);
    this.fields.delete(self);
    if (value) {
      await this.host.release(value.font);
      await this.host.release(value.color);
    }
    await this.host.deallocateView(self);
  }
}
