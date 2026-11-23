import { readString } from "../../../memory/guest-memory";
import { installArrayMethods } from "../arrays";
import { installDecimalNumbers } from "../decimal/bindings";
import { installNumbers } from "../numbers";
import { installStringPaths } from "../paths";
import { installValues } from "../values";
import type { FoundationContext } from "./types";

export function installNumberHosts(ctx: FoundationContext): void {
  const { cpu, heap, hostClass, method, state, h } = ctx;
  installArrayMethods({
    method,
    autorelease: ctx.autorelease,
    items: ctx.items,
    array: ctx.array,
    send: ctx.send,
    retain: ctx.retain,
    release: ctx.release,
    selectorName: (pointer) => readString(cpu, pointer),
  });
  installStringPaths({
    method,
    string: ctx.string,
    text: ctx.text,
    array: ctx.array,
    autorelease: ctx.autorelease,
    items: ctx.items,
  });
  installValues({
    hostClass,
    method,
    alloc: ctx.alloc,
    destroy: ctx.destroy,
    autorelease: ctx.autorelease,
    retain: ctx.retain,
    release: ctx.release,
    text: ctx.text,
    string: ctx.string,
    write: ctx.write,
    cString: (value) => heap.string(value),
  });
  hostClass("NSNumber", "NSValue");
  const releaseNumberType = installNumbers({
    isNumber: (pointer) => state.numbers.has(pointer),
    method,
    alloc: ctx.alloc,
    autorelease: ctx.autorelease,
    cString: (value) => heap.string(value),
    writeBytes: (pointer, bytes) => cpu.write(pointer, bytes),
    get: (pointer) => state.numbers.get(pointer) ?? 0,
    set: (pointer, value) => {
      state.numbers.set(pointer, value);
    },
  });
  const decimals = installDecimalNumbers({
    hostClass,
    method,
    alloc: ctx.alloc,
    destroy: ctx.destroy,
    autorelease: ctx.autorelease,
    retain: ctx.retain,
    release: ctx.release,
    text: ctx.text,
    string: ctx.string,
    write: ctx.write,
    cString: (value) => heap.string(value),
    writeBytes: (pointer, bytes) => cpu.write(pointer, bytes),
    set: (pointer, value) => {
      state.numbers.set(pointer, value);
    },
  });
  ctx.late.decimals.set(decimals);
  for (const selector of ["stringValue", "description"]) {
    method("NSNumber", false, selector, (self) => ctx.string(h.numberText(self)));
  }
  method("NSNumber", false, "copy", ctx.retain);
  method("NSNumber", false, "dealloc", (self) => {
    decimals.forget(self);
    releaseNumberType(self);
    state.numbers.delete(self);
    ctx.destroy(self);
  });
}
