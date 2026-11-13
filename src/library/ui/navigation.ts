import { element } from "../../ui/dom";
const Page = { Library: "library", Activity: "activity", Settings: "settings" } as const;
export function connectNavigation(activity: () => void): void {
  const pages = Object.values(Page).map((id) => element(id, HTMLElement));
  const buttons = [...document.querySelectorAll("button[data-page]")];
  for (const button of buttons) {
    if (!(button instanceof HTMLButtonElement)) continue;
    button.addEventListener("click", () => {
      const destination = button.dataset.page;
      for (const page of pages) page.hidden = page.id !== destination;
      for (const item of buttons) item.classList.toggle("active", item === button);
      if (destination === Page.Activity) activity();
    });
  }
}
