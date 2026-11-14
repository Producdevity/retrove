import { afterEach, expect, test, vi } from "vite-plus/test";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
test("motion activation announces a need without requesting permission outside a user gesture", async () => {
  let requests = 0;
  class Sensor {
    static async requestPermission() {
      requests++;
      return "granted";
    }
  }
  vi.stubGlobal("DeviceMotionEvent", Sensor);
  const access = await import("./access"),
    target = new EventTarget(),
    events: string[] = [];
  target.addEventListener(access.MOTION_ACCESS_REQUESTED, () => events.push("needed"));
  access.announceMotionAccess(target);
  expect(events).toEqual(["needed"]);
  expect(requests).toBe(0);
  await access.requestMotionAccess();
  expect(requests).toBe(1);
  expect(access.motionAccessRequired()).toBe(false);
  access.announceMotionAccess(target);
  expect(events).toEqual(["needed"]);
});
test("denied motion permission remains retryable and does not report a false grant", async () => {
  vi.stubGlobal("DeviceMotionEvent", { requestPermission: async () => "denied" });
  const access = await import("./access");
  await expect(access.requestMotionAccess()).rejects.toThrow("denied");
  expect(access.motionAccessRequired()).toBe(true);
});
