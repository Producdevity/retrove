import type { GlassLayer } from "../../ui/glass/layer";
import { Spring } from "../../ui/glass/spring";

const COMPACT = "(max-width: 699px)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const POSITION = { stiffness: 340, damping: 26 };
const BLOOM = { stiffness: 560, damping: 30 };
const DRAG_THRESHOLD = 6;
const GROW_X = 0.18;
const GROW_Y = 0.34;
const STRETCH_PER_SPEED = 0.02;
const MAX_STRETCH = 0.2;
const SETTLE_DISTANCE = 0.3;
const HIDDEN_AMOUNT = 0.004;
const PRECISION = 3;
const CLICK_SUPPRESSION_MS = 500;
const LENS_AXES = { x: 0.35, y: 0.9 };
const HALF = 0.5;

interface Press {
  readonly id: number;
  readonly startX: number;
  dragging: boolean;
}

/** The selection of a floating tab bar, which lifts into a liquid lens while touched. */
export class TabBar {
  private readonly buttons: HTMLButtonElement[];
  private readonly x = new Spring(0, 0, POSITION.stiffness, POSITION.damping);
  private readonly amount = new Spring(0, 0, BLOOM.stiffness, BLOOM.damping);
  private index = 0;
  private press: Press | undefined;
  private releasing = false;
  private frame = 0;
  private last = 0;
  private suppressUntil = 0;
  private readonly compact = matchMedia(COMPACT);
  private readonly calm = matchMedia(REDUCED_MOTION);
  constructor(
    private readonly nav: HTMLElement,
    private readonly selection: HTMLElement,
    private readonly lens: () => GlassLayer | undefined,
  ) {
    this.buttons = [...nav.querySelectorAll("button[data-page]")].filter(
      (button) => button instanceof HTMLButtonElement,
    );
    this.index = Math.max(
      0,
      this.buttons.findIndex((button) => button.getAttribute("aria-current") === "page"),
    );
    nav.addEventListener("pointerdown", this.down);
    nav.addEventListener("pointermove", this.move);
    nav.addEventListener("pointerup", this.up);
    nav.addEventListener("pointercancel", this.up);
    nav.addEventListener("click", this.click, true);
    // The bar's layout settles after styles, fonts and the standalone viewport do.
    const resized = new ResizeObserver(() => {
      if (!this.press && !this.frame) this.rest();
    });
    resized.observe(nav);
    for (const button of this.buttons) resized.observe(button);
    this.compact.addEventListener("change", () => this.rest());
    this.rest();
  }
  /** Move the selection to a page chosen without touch, such as from the keyboard. */
  select(button: HTMLButtonElement): void {
    const index = this.buttons.indexOf(button);
    if (index < 0 || index === this.index) return;
    this.index = index;
    this.x.target = this.center(index);
    if (this.calm.matches || !this.compact.matches) this.x.jump(this.x.target);
    this.start();
  }
  private center(index: number): number {
    const button = this.buttons[index];
    return button ? button.offsetLeft + button.offsetWidth * HALF : 0;
  }
  private nearest(x: number): number {
    let best = 0;
    for (let index = 1; index < this.buttons.length; index++)
      if (Math.abs(this.center(index) - x) < Math.abs(this.center(best) - x)) best = index;
    return best;
  }
  private localX(event: PointerEvent): number {
    const bounds = this.nav.getBoundingClientRect();
    const first = this.center(0),
      last = this.center(this.buttons.length - 1);
    return Math.min(last, Math.max(first, event.clientX - bounds.left));
  }
  private rest(): void {
    this.x.jump(this.center(this.index));
    this.amount.jump(0);
    this.apply();
  }
  private readonly down = (event: PointerEvent): void => {
    if (!this.compact.matches || this.calm.matches || !event.isPrimary) return;
    this.press = { id: event.pointerId, startX: event.clientX, dragging: false };
    this.releasing = false;
    this.amount.target = 1;
    this.x.target = this.localX(event);
    this.selection.classList.add("lifted");
    this.start();
    // A finger that slides off the bar still releases on it.
    this.nav.setPointerCapture(event.pointerId);
  };
  private readonly move = (event: PointerEvent): void => {
    const press = this.press;
    if (!press || press.id !== event.pointerId) return;
    if (!press.dragging && Math.abs(event.clientX - press.startX) > DRAG_THRESHOLD)
      press.dragging = true;
    if (press.dragging) this.x.target = this.localX(event);
  };
  private readonly up = (event: PointerEvent): void => {
    const press = this.press;
    if (!press || press.id !== event.pointerId) return;
    this.press = undefined;
    this.releasing = true;
    const target = event.type === "pointercancel" ? this.index : this.nearest(this.localX(event));
    this.x.target = this.center(target);
    // The release itself switches pages: iOS drops the click of a tap that moved slightly,
    // which left the selection on the new tab while the old page stayed.
    if (event.type !== "pointercancel") {
      this.suppressUntil = performance.now() + CLICK_SUPPRESSION_MS;
      this.buttons[target]?.click();
    }
    this.start();
  };
  private readonly click = (event: MouseEvent): void => {
    if (event.detail > 0 && performance.now() < this.suppressUntil) {
      event.stopPropagation();
      event.preventDefault();
      this.suppressUntil = 0;
    }
  };
  private start(): void {
    if (this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }
  private readonly tick = (now: number): void => {
    this.frame = 0;
    const elapsed = now - this.last;
    this.last = now;
    this.x.step(elapsed);
    const width = this.buttons[this.index]?.offsetWidth ?? 1;
    if (this.releasing && Math.abs(this.x.target - this.x.value) < width * SETTLE_DISTANCE)
      this.amount.target = 0;
    this.amount.step(elapsed);
    const done = !this.press && this.x.settled && this.amount.settled;
    if (done) {
      this.releasing = false;
      this.amount.jump(0);
    }
    this.apply();
    if (!done) this.frame = requestAnimationFrame(this.tick);
  };
  private apply(): void {
    const button = this.buttons[this.index];
    if (!button) return;
    const amount = Math.max(0, this.amount.value);
    const stretch = Math.min(
      MAX_STRETCH * button.offsetWidth,
      Math.abs(this.x.velocity) * STRETCH_PER_SPEED * amount,
    );
    const width = button.offsetWidth * (1 + GROW_X * amount) + stretch;
    const height = button.offsetHeight * (1 + GROW_Y * amount);
    const left = this.x.value - width * HALF,
      top = button.offsetTop + (button.offsetHeight - height) * HALF;
    Object.assign(this.selection.style, {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${left}px, ${top}px)`,
    });
    const lifted = amount > HIDDEN_AMOUNT || Boolean(this.press);
    // The resting pill and the lens cross-fade, so the glass never pops out.
    this.selection.style.setProperty("--lift", Math.min(1, amount).toFixed(PRECISION));
    this.selection.classList.toggle("lifted", lifted);
    const lens = this.lens();
    if (!lens) return;
    if (lifted) {
      lens.set("lens", {
        element: this.selection,
        look: {
          shape: "pill",
          tint: 0,
          frost: 0,
          opacity: Math.min(1, amount),
          pressure: amount,
          pressureAxes: [LENS_AXES.x, LENS_AXES.y],
        },
      });
      lens.draw();
    } else lens.remove("lens");
  }
}
