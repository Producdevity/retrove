import { Stage } from "./stages";

export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}
export interface FieldState {
  readonly stage: Stage;
  /** Shown progress through the stage, 0 to 1. */
  readonly progress: number;
  /** Milliseconds since the stage began. */
  readonly elapsed: number;
  readonly time: number;
  readonly calm: boolean;
  /** 0 while booting; rises to 1 as the dots fuse into the first frame. */
  readonly merge: number;
}
export const GRID = 14;
const CELLS = GRID * GRID;
const LOOK = {
  inset: 10,
  dot: 5.2,
  radius: 30,
  laid: 0.12,
  bound: 0.2,
  resolved: 0.95,
  pulseLead: 0.022,
  flash: 0.025,
  tickMs: 450,
  breatheMs: 520,
  sweepMs: 2600,
};
const NEUTRAL: Color = { r: 205, g: 213, b: 230 };
const WHITE: Color = { r: 250, g: 252, b: 255 };
const RUN = { min: 2, spread: 8, seed: 3, finish: 0.985, within: 0.6 };
const HASH = {
  a: 0x9e3779b9,
  b: 0x85ebca6b,
  c: 0x632be59b,
  d: 0xc2b2ae35,
  e: 0x27d4eb2f,
  shift: 13,
  fold: 16,
  range: 4294967296,
};
const UNPACK = { overshoot: 1.04, appear: 0.04, glow: 0.32, fade: 0.06 };
const LINK = { lead: 3, behind: 1.5, reach: 0.8, width: 1.1, glow: 0.38 };
const PULSE = { base: 0.3, swing: 0.35, rate: 95, phase: 0.9, flash: 0.8 };
const SWEEP = { span: 1.7, start: 0.35, width: 0.16, lift: 0.22 };
const RIM = {
  top: 0.22,
  middle: 0.05,
  bottom: 0.1,
  tickTop: 0.5,
  tickMiddle: 0.25,
  tickBottom: 0.4,
  breathe: 0.1,
};
const HALF = 0.5;
const LAST = GRID - 1;
const MAX_SCALE = 3;

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;
const mix = (color: Color, amount: number): Color => ({
  r: lerp(color.r, WHITE.r, amount),
  g: lerp(color.g, WHITE.g, amount),
  b: lerp(color.b, WHITE.b, amount),
});
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ HASH.a, HASH.b) ^ Math.imul(b + HASH.c, HASH.d);
  h ^= h >>> HASH.shift;
  h = Math.imul(h, HASH.e);
  return ((h ^ (h >>> HASH.fold)) >>> 0) / HASH.range;
}
interface Dot {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  /** Where this dot falls in the order code resolves: short runs, like functions. */
  readonly rank: number;
}
function dots(): Dot[] {
  const runs: [number, number][] = [];
  for (let start = 0; start < CELLS;) {
    const length = RUN.min + Math.floor(hash(start, RUN.seed) * RUN.spread);
    runs.push([start, Math.min(length, CELLS - start)]);
    start += length;
  }
  return runs.flatMap(([start, length], run) =>
    Array.from({ length }, (_, offset) => {
      const index = start + offset;
      const rank = ((run + RUN.within * (offset / length)) / runs.length) * RUN.finish;
      return { index, x: index % GRID, y: Math.floor(index / GRID), rank };
    }),
  );
}

function style(dot: Dot, color: Color, state: FieldState): [Color, number] {
  const { progress: p, calm } = state;
  const diagonal = (dot.x + dot.y) / (LAST + LAST);
  switch (state.stage) {
    case Stage.Unpack: {
      const age = p * UNPACK.overshoot - dot.index / CELLS;
      if (age < 0) return [NEUTRAL, 0];
      const glow = calm ? 0 : UNPACK.glow * (1 - clamp(age / UNPACK.fade));
      return [NEUTRAL, LOOK.laid * clamp(age / UNPACK.appear) + glow];
    }
    case Stage.Link: {
      const passed = p * (GRID + LINK.lead) - LINK.behind - dot.x;
      if (passed < -LINK.reach) return [NEUTRAL, LOOK.laid];
      const head = calm ? 0 : clamp(1 - Math.abs(passed) / LINK.width);
      return [NEUTRAL, (passed > 0 ? LOOK.bound : LOOK.laid) + LINK.glow * head];
    }
    case Stage.Start: {
      const ahead = dot.rank - p;
      if (ahead > 0) {
        if (calm || ahead >= LOOK.pulseLead) return [NEUTRAL, LOOK.bound];
        const pulse = HALF + HALF * Math.sin(state.time / PULSE.rate - dot.index * PULSE.phase);
        return [NEUTRAL, PULSE.base + PULSE.swing * pulse];
      }
      const flash = calm ? 0 : clamp(1 + ahead / LOOK.flash);
      return [mix(color, flash * PULSE.flash), LOOK.resolved];
    }
    case Stage.Frame: {
      const sweep = ((state.time % LOOK.sweepMs) / LOOK.sweepMs) * SWEEP.span - SWEEP.start;
      const lift = calm ? 0 : clamp(1 - Math.abs(diagonal - sweep) / SWEEP.width) * SWEEP.lift;
      return [mix(color, lift), LOOK.resolved];
    }
  }
}

/** The app icon as a grid of dots that fills in as the runtime does real work. */
export class DotField {
  private readonly dots = dots();
  private colors: Color[] = Array.from({ length: CELLS }, () => NEUTRAL);
  private readonly context: CanvasRenderingContext2D | null;
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly size: number,
  ) {
    this.context = canvas.getContext("2d");
  }
  setIcon(colors: Color[]): void {
    if (colors.length === CELLS) this.colors = colors;
  }
  draw(state: FieldState): void {
    const context = this.context;
    if (!context) return;
    const scale = Math.min(devicePixelRatio, MAX_SCALE);
    const pixels = Math.round(this.size * scale);
    if (this.canvas.width !== pixels) this.canvas.width = this.canvas.height = pixels;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, this.size, this.size);
    context.save();
    context.beginPath();
    context.roundRect(0, 0, this.size, this.size, LOOK.radius);
    context.clip();
    context.fillStyle = "#0a0c11";
    context.fillRect(0, 0, this.size, this.size);
    this.drawDots(context, state, scale);
    context.restore();
    this.drawRim(context, state);
  }
  private drawDots(context: CanvasRenderingContext2D, state: FieldState, scale: number): void {
    const inset = lerp(LOOK.inset, 0, state.merge);
    const pitch = (this.size - inset - inset) / GRID;
    const size = lerp(LOOK.dot, pitch, state.merge);
    const snap = (value: number): number => Math.round(value * scale) / scale;
    for (const dot of this.dots) {
      const [color, base] = style(dot, this.colors[dot.index] ?? NEUTRAL, state);
      const alpha = lerp(base, 1, state.merge);
      if (alpha <= 0) continue;
      context.fillStyle = `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)} / ${alpha})`;
      if (state.merge >= 1) {
        const left = snap(inset + dot.x * pitch),
          top = snap(inset + dot.y * pitch);
        context.fillRect(
          left,
          top,
          snap(inset + (dot.x + 1) * pitch) - left,
          snap(inset + (dot.y + 1) * pitch) - top,
        );
        continue;
      }
      const x = inset + (dot.x + HALF) * pitch - size * HALF,
        y = inset + (dot.y + HALF) * pitch - size * HALF;
      context.beginPath();
      context.roundRect(x, y, size, size, lerp(size * HALF, 0, state.merge));
      context.fill();
    }
  }
  private drawRim(context: CanvasRenderingContext2D, state: FieldState): void {
    const tick =
      state.calm || state.stage === Stage.Unpack ? 0 : 1 - clamp(state.elapsed / LOOK.tickMs);
    const breathe =
      state.stage === Stage.Frame && !state.calm
        ? HALF + HALF * Math.sin(state.time / LOOK.breatheMs)
        : 0;
    const rim = context.createLinearGradient(0, 0, 0, this.size);
    rim.addColorStop(
      0,
      `rgb(255 255 255 / ${RIM.top + RIM.tickTop * tick + RIM.breathe * breathe})`,
    );
    rim.addColorStop(HALF, `rgb(255 255 255 / ${RIM.middle + RIM.tickMiddle * tick})`);
    rim.addColorStop(
      1,
      `rgb(255 255 255 / ${RIM.bottom + RIM.tickBottom * tick + RIM.breathe * HALF * breathe})`,
    );
    context.strokeStyle = rim;
    context.lineWidth = 1 + tick * HALF;
    context.beginPath();
    context.roundRect(HALF, HALF, this.size - 1, this.size - 1, LOOK.radius);
    context.stroke();
  }
}
