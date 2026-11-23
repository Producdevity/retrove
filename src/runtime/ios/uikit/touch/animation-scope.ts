import type { TouchState } from "./context";

const CURVES = ["ease-in-out", "ease-in", "ease-out", "linear"] as const;
const CURVE_SHIFT = 16;
const CURVE_MASK = 3;

export async function withAnimation<T>(
  state: TouchState,
  seconds: number,
  delay: number,
  options: number,
  changes: () => Promise<T>,
): Promise<T> {
  const previous = state.animation;
  const start = performance.now();
  state.animation = {
    duration: Math.max(0, seconds),
    delay: Math.max(0, delay),
    curve: CURVES[(options >>> CURVE_SHIFT) & CURVE_MASK] ?? CURVES[0],
    start,
  };
  try {
    return await changes();
  } finally {
    state.animation = previous;
  }
}
