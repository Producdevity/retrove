import { WORD_BYTES } from "../../abi/scalars";
import { Argument, type FoundationHost } from "../../objc/host";
import { browserMotion, type Acceleration, type MotionSource } from "./source";

const Class = { Accelerometer: "UIAccelerometer", Acceleration: "UIAcceleration" } as const;
const DEFAULT_UPDATE_INTERVAL = 0.1;
interface AccelerometerHost extends Pick<
  FoundationHost,
  "hostClass" | "method" | "alloc" | "release" | "destroy"
> {
  send(receiver: number, selector: string, args: number[]): Promise<number>;
}
export function installAccelerometer(
  host: AccelerometerHost,
  source: MotionSource = browserMotion(),
) {
  const accelerometerClass = host.hostClass(Class.Accelerometer, "NSObject");
  const accelerationClass = host.hostClass(Class.Acceleration, "NSObject");
  const samples = new Map<number, Acceleration>();
  const bits = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));
  let singleton = 0,
    delegate = 0,
    interval = DEFAULT_UPDATE_INTERVAL,
    previous = -Infinity;
  const double = (value: number): bigint => {
    bits.setFloat64(0, value, true);
    return bits.getBigUint64(0, true);
  };
  host.method(
    Class.Accelerometer,
    true,
    "sharedAccelerometer",
    () => (singleton ||= host.alloc(accelerometerClass)),
  );
  host.method(Class.Accelerometer, false, "delegate", () => delegate);
  host.method(Class.Accelerometer, false, "setDelegate:", (_self, args) => {
    source.stop();
    delegate = args(Argument.First);
    previous = -Infinity;
    if (delegate) source.start();
  });
  host.method(Class.Accelerometer, false, "updateInterval", () => double(interval));
  host.method(Class.Accelerometer, false, "setUpdateInterval:", (_self, args) => {
    bits.setUint32(0, args(Argument.First), true);
    bits.setUint32(WORD_BYTES, args(Argument.Second), true);
    const value = bits.getFloat64(0, true);
    if (!Number.isFinite(value) || value <= 0)
      throw new Error("UIAccelerometer update interval must be positive.");
    interval = value;
  });
  for (const property of ["x", "y", "z", "timestamp"] as const) {
    host.method(Class.Acceleration, false, property, (self) =>
      double(samples.get(self)?.[property] ?? 0),
    );
  }
  host.method(Class.Acceleration, false, "dealloc", (self) => {
    samples.delete(self);
    host.destroy(self);
  });
  return {
    async pump(active = true): Promise<void> {
      const value = source.take();
      if (!active || !delegate || !value || value.timestamp - previous < interval) return;
      previous = value.timestamp;
      const sample = host.alloc(accelerationClass);
      samples.set(sample, value);
      try {
        await host.send(delegate, "accelerometer:didAccelerate:", [singleton, sample]);
      } finally {
        await host.release(sample);
      }
    },
    close(): void {
      source.stop();
      delegate = 0;
    },
  };
}
