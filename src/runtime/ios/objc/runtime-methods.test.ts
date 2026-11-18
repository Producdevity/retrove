import { describe, expect, it } from "vite-plus/test";
import type { MethodValue } from "./implementations";
import { runtimeMethodImports } from "./runtime-methods";

const BASE = 0x100,
  CHILD = 0x200;
function setup() {
  const memory = new Map<number, number>();
  const strings = new Map<number, string>();
  let next = 0x10000;
  const selectors = new Map<string, number>();
  const text = (value: string) => {
    const pointer = (next += 0x40);
    strings.set(pointer, value);
    return pointer;
  };
  const selector = (name: string) => {
    let pointer = selectors.get(name);
    if (!pointer) {
      pointer = text(name);
      selectors.set(name, pointer);
    }
    return pointer;
  };
  const methods = new Map<number, Map<string, MethodValue>>([
    [
      BASE,
      new Map<string, MethodValue>([
        ["draw", 0x1000],
        ["update", 0x2000],
      ]),
    ],
    [CHILD, new Map<string, MethodValue>()],
  ]);
  memory.set(CHILD + 4, BASE);
  const imports = runtimeMethodImports({
    read: (pointer) => memory.get(pointer) ?? 0,
    write: (pointer, value) => void memory.set(pointer, value),
    allocate: (bytes) => (next += Math.max(bytes, 0x40)),
    cString: (pointer) => strings.get(pointer) ?? "",
    permanentString: text,
    selector,
    methods: (pointer) => methods.get(pointer),
    classList: () => [BASE, CHILD],
    address: (value) => (typeof value === "number" ? value : 0),
    typeEncoding: () => undefined,
  });
  const call = (name: keyof typeof imports, ...values: number[]) =>
    imports[name]?.((index) => values[index] ?? 0);
  return { call, selector, methods, memory };
}

describe("runtime methods", () => {
  it("finds inherited methods and exchanges implementations", () => {
    const { call, selector, methods } = setup();
    const draw = call("_class_getInstanceMethod", CHILD, selector("draw"));
    const update = call("_class_getInstanceMethod", BASE, selector("update"));
    expect(draw).toBeTruthy();
    expect(call("_method_getImplementation", draw ?? 0)).toBe(0x1000);
    call("_method_exchangeImplementations", draw ?? 0, update ?? 0);
    expect(methods.get(BASE)?.get("draw")).toBe(0x2000);
    expect(methods.get(BASE)?.get("update")).toBe(0x1000);
  });
  it("adds a method only when the class does not define it", () => {
    const { call, selector, methods } = setup();
    expect(call("_class_addMethod", CHILD, selector("draw"), 0x3000)).toBe(1);
    expect(call("_class_addMethod", CHILD, selector("draw"), 0x4000)).toBe(0);
    expect(methods.get(CHILD)?.get("draw")).toBe(0x3000);
  });
  it("lists classes into a buffer", () => {
    const { call, memory } = setup();
    expect(call("_objc_getClassList", 0x500, 1)).toBe(2);
    expect(memory.get(0x500)).toBe(BASE);
    expect(memory.has(0x504)).toBe(false);
  });
});
