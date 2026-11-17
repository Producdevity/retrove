const DURATION_OPEN = 560;
const DURATION_CLOSE = 420;
const HALF = 0.5;
const SPRING = "cubic-bezier(0.3, 1.25, 0.5, 1)";
const SETTLE = "cubic-bezier(0.4, 0, 0.2, 1)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Grows `target` out of `source`, or folds it back, the way a glass control changes shape
 * instead of fading. Content inside the target fades so it never squashes.
 */
export function morph(
  target: HTMLElement,
  source: HTMLElement,
  opening: boolean,
  animating: (milliseconds: number) => void = () => undefined,
): Promise<void> {
  if (matchMedia(REDUCED_MOTION).matches) {
    const fade = target.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], {
      duration: DURATION_CLOSE * HALF,
      fill: "forwards",
    });
    return fade.finished.then(() => fade.cancel());
  }
  const from = source.getBoundingClientRect(),
    to = target.getBoundingClientRect();
  const dx = from.left + from.width * HALF - (to.left + to.width * HALF),
    dy = from.top + from.height * HALF - (to.top + to.height * HALF);
  const collapsed = {
    transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`,
    opacity: 0,
  };
  const expanded = { transform: "none", opacity: 1 };
  const duration = opening ? DURATION_OPEN : DURATION_CLOSE;
  animating(duration);
  const shape = target.animate(opening ? [collapsed, expanded] : [expanded, collapsed], {
    duration,
    easing: opening ? SPRING : SETTLE,
    fill: "forwards",
  });
  const content = [...target.children].filter((child) => child instanceof HTMLElement);
  for (const child of content)
    child.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], {
      duration: duration * HALF,
      delay: opening ? duration * HALF * HALF : 0,
      fill: "both",
    });
  return shape.finished.then(() => {
    shape.cancel();
    for (const child of content) for (const animation of child.getAnimations()) animation.cancel();
  });
}
