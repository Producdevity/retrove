import { announceMotionAccess } from "./access";
const GRAVITY_METERS_PER_SECOND_SQUARED = 9.80665;
const MILLISECONDS_PER_SECOND = 1000;
const MOTION_EVENT = "devicemotion";
export const MotionConvention = { Apple: "apple", Standard: "standard" } as const;
export type MotionConvention = (typeof MotionConvention)[keyof typeof MotionConvention];
export interface Acceleration {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly timestamp: number;
}
export interface MotionSource {
  start(): void;
  stop(): void;
  take(): Acceleration | undefined;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function acceleration(event: Event, convention: MotionConvention): Acceleration | undefined {
  if (!("accelerationIncludingGravity" in event)) return undefined;
  const value = event.accelerationIncludingGravity;
  if (
    !value ||
    typeof value !== "object" ||
    !("x" in value) ||
    !("y" in value) ||
    !("z" in value) ||
    !finite(value.x) ||
    !finite(value.y) ||
    !finite(value.z) ||
    !finite(event.timeStamp)
  )
    return undefined;
  const scale =
    (convention === MotionConvention.Apple ? 1 : -1) / GRAVITY_METERS_PER_SECOND_SQUARED;
  return {
    x: value.x * scale,
    y: value.y * scale,
    z: value.z * scale,
    timestamp: event.timeStamp / MILLISECONDS_PER_SECOND,
  };
}
export class BrowserMotion implements MotionSource {
  private pending: Acceleration | undefined;
  private listening = false;
  constructor(
    private readonly target: EventTarget | undefined,
    private readonly convention: MotionConvention,
  ) {}
  private readonly receive = (event: Event): void => {
    this.pending = acceleration(event, this.convention);
  };
  start(): void {
    if (this.listening || !this.target) return;
    this.target.addEventListener(MOTION_EVENT, this.receive);
    this.listening = true;
    announceMotionAccess(this.target);
  }
  stop(): void {
    this.target?.removeEventListener(MOTION_EVENT, this.receive);
    this.listening = false;
    this.pending = undefined;
  }
  take(): Acceleration | undefined {
    const value = this.pending;
    this.pending = undefined;
    return value;
  }
}
export function browserMotion(): MotionSource {
  // WebKit on Apple devices preserves CoreMotion's sign, opposite to the W3C convention.
  const apple = /iPhone|iPad|iPod|Macintosh/.test(globalThis.navigator?.userAgent ?? "");
  return new BrowserMotion(
    typeof window === "undefined" ? undefined : window,
    apple ? MotionConvention.Apple : MotionConvention.Standard,
  );
}
