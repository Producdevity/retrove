export const MOTION_ACCESS_REQUESTED = "retrove-motion-access-requested";
let granted = false;
function requester(): (() => Promise<unknown>) | undefined {
  const source = globalThis.DeviceMotionEvent;
  if (!source || !("requestPermission" in source) || typeof source.requestPermission !== "function")
    return undefined;
  const request = source.requestPermission;
  return async () => {
    const result: unknown = await request.call(source);
    return result;
  };
}
export function motionAccessRequired(): boolean {
  return !granted && Boolean(requester());
}
export async function requestMotionAccess(): Promise<void> {
  const request = requester();
  if (!request) return;
  const result = await request();
  if (result !== "granted")
    throw new Error(
      "Motion access was denied. Allow motion access in your browser settings to use tilt controls.",
    );
  granted = true;
}
export function announceMotionAccess(target: EventTarget): void {
  if (motionAccessRequired()) target.dispatchEvent(new Event(MOTION_ACCESS_REQUESTED));
}
