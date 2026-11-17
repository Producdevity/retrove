import { DotField, GRID, type Color } from "./field";
import { bootSignal, Stage, STAGE_TITLES } from "./stages";

const TILE = 132;
const ESTIMATE_MS = {
  [Stage.Unpack]: 1400,
  [Stage.Link]: 2400,
  [Stage.Start]: 6000,
  [Stage.Frame]: 1,
};
const ESTIMATE_CEILING = 0.9;
const FOLLOW = 0.12;
const MERGE_MS = 240;
const OPEN_MS = 620;
const LABEL_MS = 380;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const HALF = 0.5;
const CHANNEL = { red: 0, green: 1, blue: 2, stride: 4 };
const PRECISION = 2;
const STAGES = [Stage.Unpack, Stage.Link, Stage.Start, Stage.Frame];

async function iconColors(icon: Blob): Promise<Color[]> {
  const bitmap = await createImageBitmap(icon);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = GRID;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  context.drawImage(bitmap, 0, 0, GRID, GRID);
  bitmap.close();
  const data = context.getImageData(0, 0, GRID, GRID).data;
  const colors: Color[] = [];
  for (let offset = 0; offset < data.length; offset += CHANNEL.stride)
    colors.push({
      r: data[offset + CHANNEL.red] ?? 0,
      g: data[offset + CHANNEL.green] ?? 0,
      b: data[offset + CHANNEL.blue] ?? 0,
    });
  return colors;
}

/**
 * The loading screen. Each stage follows a real runtime milestone; where the runtime cannot
 * report how far along it is, progress eases toward an estimate and never claims to finish.
 */
export class BootSequence {
  private readonly field: DotField;
  private stage: Stage = Stage.Unpack;
  private known: number | undefined;
  private shown = 0;
  private stageStart = performance.now();
  private merge = 0;
  private frame = 0;
  private stopped = false;
  private labelled = false;
  private readonly calm = matchMedia(REDUCED_MOTION);
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly steps: HTMLElement,
    private readonly title: HTMLElement,
    private readonly detail: HTMLElement,
  ) {
    this.field = new DotField(canvas, TILE);
    this.frame = requestAnimationFrame(this.tick);
  }
  setIcon(icon: Blob | null): void {
    if (icon)
      void iconColors(icon).then(
        (colors) => this.field.setIcon(colors),
        () => undefined,
      );
  }
  /** Returns whether the diagnostic was a boot milestone. */
  signal(area: string, message: string, details: unknown): boolean {
    const signal = bootSignal(area, message, details);
    if (!signal || signal.stage < this.stage || this.stopped) return false;
    if (signal.stage > this.stage || !this.labelled) {
      this.labelled = true;
      this.stage = signal.stage;
      this.shown = 0;
      this.known = undefined;
      this.stageStart = performance.now();
      this.label(this.title, STAGE_TITLES[signal.stage]);
    }
    if (signal.progress !== undefined) this.known = Math.max(this.known ?? 0, signal.progress);
    this.detail.textContent = signal.detail;
    return true;
  }
  /** Freezes the animation, for a failure or a closed app. */
  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
  }
  /** Fuses the dots into the first frame and grows them into the display. */
  async finish(display: HTMLElement, overlay: HTMLElement): Promise<void> {
    if (this.stopped) return;
    this.stage = Stage.Frame;
    const calm = this.calm.matches;
    if (!calm) {
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const step = (now: number): void => {
          this.merge = Math.min(1, (now - start) / MERGE_MS);
          if (this.merge < 1) requestAnimationFrame(step);
          else requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        };
        requestAnimationFrame(step);
      });
    }
    this.stop();
    const from = this.canvas.getBoundingClientRect(),
      to = display.getBoundingClientRect();
    const dx = to.left + to.width * HALF - (from.left + from.width * HALF),
      dy = to.top + to.height * HALF - (from.top + from.height * HALF);
    const grow = calm
      ? []
      : [
          { transform: "none" },
          {
            transform: `translate(${dx}px, ${dy}px) scale(${to.width / from.width}, ${to.height / from.height})`,
          },
        ];
    const tile = this.canvas.animate(grow, {
      duration: OPEN_MS,
      easing: "cubic-bezier(0.6, 0, 0.2, 1)",
    });
    const fade = overlay.animate([{ opacity: 1 }, { opacity: 1, offset: HALF }, { opacity: 0 }], {
      duration: calm ? OPEN_MS * HALF : OPEN_MS,
      fill: "forwards",
    });
    await Promise.all([tile.finished, fade.finished]);
  }
  private label(element: HTMLElement, text: string): void {
    element.textContent = text;
    if (this.calm.matches) return;
    element.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: LABEL_MS, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" },
    );
  }
  private readonly tick = (time: number): void => {
    const elapsed = time - this.stageStart;
    const estimate = ESTIMATE_CEILING * (1 - Math.exp(-elapsed / ESTIMATE_MS[this.stage]));
    const target = this.stage === Stage.Frame ? 1 : Math.max(this.known ?? 0, estimate);
    this.shown += (Math.max(this.shown, target) - this.shown) * FOLLOW;
    this.field.draw({
      stage: this.stage,
      progress: this.shown,
      elapsed,
      time,
      calm: this.calm.matches,
      merge: this.merge,
    });
    STAGES.forEach((stage, index) => {
      const fill = stage < this.stage ? 1 : stage === this.stage ? this.shown : 0;
      const step = this.steps.children.item(index);
      if (step instanceof HTMLElement) step.style.setProperty("--fill", fill.toFixed(PRECISION));
    });
    this.frame = requestAnimationFrame(this.tick);
  };
}
