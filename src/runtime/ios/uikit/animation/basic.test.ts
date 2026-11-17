import { expect, test } from "vite-plus/test";
import { floatBits } from "../../abi/scalars";
import type { HostMethod } from "../../objc/host";
import { AnimationSymbols, installBasicAnimations, type LayerOpacity } from "./basic";

const setup = () => {
  const methods = new Map<string, HostMethod>(),
    sent: [number, string, number[]][] = [],
    texts = new Map<number, string>([
      [50, "opacity"],
      [51, "fade"],
      [52, AnimationSymbols._kCAFillModeForwards],
    ]),
    layer: LayerOpacity = { alpha: 1 };
  let now = 0,
    next = 100;
  const animations = installBasicAnimations({
    hostClass: () => 0,
    method: (className, classMethod, selector, implementation) =>
      methods.set(`${classMethod ? "+" : "-"}[${className} ${selector}]`, implementation),
    alloc: () => next++,
    destroy: () => undefined,
    retain: (pointer) => pointer,
    release: async () => undefined,
    autorelease: (pointer) => pointer,
    text: (pointer) => texts.get(pointer) ?? "",
    string: () => 0,
    send: async (receiver, selector, args = []) => {
      sent.push([receiver, selector, args]);
      return selector === "floatValue" ? floatBits(0) : 0;
    },
    responds: (receiver) => receiver === 70,
    layer: () => layer,
    now: () => now,
  });
  const call = async (name: string, self: number, ...args: number[]) =>
    methods.get(name)?.(self, (index) => args[index] ?? 0);
  return { animations, call, sent, layer, advance: (ms: number) => (now += ms) };
};

test("a forward-filled opacity animation keeps its end state and reports completion", async () => {
  const { animations, call, sent, layer, advance } = setup();
  const animation = Number(await call("+[CAPropertyAnimation animationWithKeyPath:]", 1, 50));
  await call("-[CAAnimation setDuration:]", animation, 0, 0x3fe00000);
  await call("-[CAAnimation setToValue:]", animation, 60);
  await call("-[CAAnimation setRemovedOnCompletion:]", animation, 0);
  await call("-[CAAnimation setFillMode:]", animation, 52);
  await call("-[CAAnimation setDelegate:]", animation, 70);
  await call("-[CALayer addAnimation:forKey:]", 9, animation, 51);
  expect(layer.alpha).toBe(0);
  expect(layer.opacityAnimation?.duration).toBe(0.5);
  expect(await call("-[CALayer animationForKey:]", 9, 51)).toBe(animation);
  advance(499);
  await animations.pump();
  expect(sent.some(([, selector]) => selector === "animationDidStop:finished:")).toBe(false);
  advance(1);
  await animations.pump();
  expect(sent.at(-1)).toEqual([70, "animationDidStop:finished:", [animation, 1]]);
  expect(animations.pending()).toBe(false);
});

test("removing an animation stops it unfinished and leaves the model value alone", async () => {
  const { call, sent, layer } = setup();
  const animation = Number(await call("+[CAPropertyAnimation animationWithKeyPath:]", 1, 50));
  await call("-[CAAnimation setToValue:]", animation, 60);
  await call("-[CAAnimation setDelegate:]", animation, 70);
  await call("-[CALayer addAnimation:forKey:]", 9, animation, 51);
  expect(layer.alpha).toBe(1);
  await call("-[CALayer removeAllAnimations]", 9);
  expect(sent.at(-1)).toEqual([70, "animationDidStop:finished:", [animation, 0]]);
});
