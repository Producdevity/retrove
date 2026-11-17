import { element } from "../../ui/dom";
import type { TabBar } from "./tab-bar";
export const Page = { Library: "library", Activity: "activity", Settings: "settings" } as const;
export type Page = (typeof Page)[keyof typeof Page];
const EDGE_START = 24;
const EDGE_RANGE = 36;
const PRECISION = 3;

/** Switches pages from the tab bar or sidebar, and returns a way to switch from code. */
export function connectNavigation(
  tabBar: TabBar,
  shown: Partial<Record<Page, () => void>>,
): (page: Page) => void {
  const pages = Object.values(Page).map((id) => element(id, HTMLElement));
  const buttons = [...document.querySelectorAll("button[data-page]")].filter(
    (button) => button instanceof HTMLButtonElement,
  );
  const title = element("inline-title", HTMLSpanElement);
  const edge = (): void => {
    const progress = Math.min(1, Math.max(0, (scrollY - EDGE_START) / EDGE_RANGE));
    document.documentElement.style.setProperty("--edge", progress.toFixed(PRECISION));
  };
  addEventListener("scroll", edge, { passive: true });
  const show = (button: HTMLButtonElement): void => {
    const destination = Object.values(Page).find((page) => page === button.dataset.page);
    if (!destination) return;
    const changed = button.getAttribute("aria-current") !== "page";
    for (const page of pages) page.hidden = page.id !== destination;
    for (const item of buttons)
      if (item === button) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    title.textContent = element(destination, HTMLElement).dataset.title ?? "";
    tabBar.select(button);
    if (changed) scrollTo({ top: 0 });
    edge();
    shown[destination]?.();
  };
  for (const button of buttons) button.addEventListener("click", () => show(button));
  edge();
  return (page) => {
    const button = buttons.find((item) => item.dataset.page === page);
    if (button) show(button);
  };
}
