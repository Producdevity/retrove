import { expect, test } from "vite-plus/test";
import { acceleration, BrowserMotion, MotionConvention } from "./source";

class MotionEvent extends Event {
  constructor(
    readonly accelerationIncludingGravity: unknown,
    private readonly time = 1000,
  ) {
    super("devicemotion");
  }
  override get timeStamp(): number {
    return this.time;
  }
}
test("Apple and standard browser readings normalize to UIKit g units", () => {
  const apple = acceleration(new MotionEvent({ x: 0, y: 0, z: -9.80665 }), MotionConvention.Apple);
  const standard = acceleration(
    new MotionEvent({ x: 0, y: 0, z: 9.80665 }),
    MotionConvention.Standard,
  );
  expect(apple?.z).toBe(-1);
  expect(standard?.z).toBe(-1);
  expect(standard?.timestamp).toBe(1);
  expect(
    acceleration(new MotionEvent({ x: null, y: 0, z: 0 }), MotionConvention.Standard),
  ).toBeUndefined();
  expect(
    acceleration(new MotionEvent({ x: NaN, y: 0, z: 0 }), MotionConvention.Standard),
  ).toBeUndefined();
});
test("motion delivery coalesces samples, detaches on stop and never fabricates unavailable readings", () => {
  const target = new EventTarget(),
    source = new BrowserMotion(target, MotionConvention.Apple);
  expect(source.take()).toBeUndefined();
  source.start();
  source.start();
  target.dispatchEvent(new MotionEvent({ x: 0, y: 0, z: -9.80665 }, 1000));
  target.dispatchEvent(new MotionEvent({ x: 9.80665, y: 0, z: 0 }, 2000));
  expect(source.take()).toEqual({ x: 1, y: 0, z: 0, timestamp: 2 });
  expect(source.take()).toBeUndefined();
  target.dispatchEvent(new MotionEvent({ x: 1, y: 2, z: 3 }));
  source.stop();
  target.dispatchEvent(new MotionEvent({ x: 4, y: 5, z: 6 }));
  expect(source.take()).toBeUndefined();
});
