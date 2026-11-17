const HOLD_MS = 450;
const MOVE_TOLERANCE = 8;
/** The click a release sends arrives within this time; a later click is a new tap. */
const RELEASE_CLICK_MS = 400;

/**
 * Calls `held` after a touch or click is held still, and swallows the click that the
 * release sends. A secondary click or the context menu key counts as a hold too.
 */
export function onLongPress(target: HTMLElement, held: () => void): void {
  let timer = 0,
    startX = 0,
    startY = 0,
    swallow = false;
  const cancel = (): void => {
    clearTimeout(timer);
    timer = 0;
    target.classList.remove("holding");
  };
  const release = (): void => {
    cancel();
    if (swallow) window.setTimeout(() => (swallow = false), RELEASE_CLICK_MS);
  };
  target.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    swallow = false;
    startX = event.clientX;
    startY = event.clientY;
    target.classList.add("holding");
    timer = window.setTimeout(() => {
      cancel();
      swallow = true;
      held();
    }, HOLD_MS);
  });
  target.addEventListener("pointermove", (event) => {
    if (timer && Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE)
      cancel();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"])
    target.addEventListener(type, release);
  target.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const alreadyHeld = swallow;
    cancel();
    if (!alreadyHeld) held();
  });
  target.addEventListener(
    "click",
    (event) => {
      if (!swallow) return;
      swallow = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}
