import { action, element, node } from "../../ui/dom";
import { Icon, icon } from "../../ui/icons";

interface InstallEvent extends Event {
  prompt(): Promise<unknown>;
}
function isInstallEvent(event: Event): event is InstallEvent {
  return "prompt" in event && typeof event.prompt === "function";
}
const DISMISSED_KEY = "retrove.install-banner-dismissed";

function installed(): boolean {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  );
}
/** Safari on iPhone and iPad; iPadOS reports a Mac user agent but has touch. */
function appleMobile(): boolean {
  const agent = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/u.test(agent) || (/Macintosh/u.test(agent) && navigator.maxTouchPoints > 1)
  );
}
function macSafari(): boolean {
  const agent = navigator.userAgent;
  return (
    /Macintosh/u.test(agent) && /Safari/u.test(agent) && !/Chrome|Chromium|Edg|Firefox/u.test(agent)
  );
}
function step(parts: readonly (string | SVGSVGElement)[]): HTMLLIElement {
  const item = node("li");
  item.append(...parts);
  return item;
}
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Offers installation where the browser supports it: the native prompt in Chromium,
 * and the exact steps in Safari, which has no prompt.
 */
export function connectInstall(showSettings: () => void, failure: (error: unknown) => void): void {
  const card = element("install-card", HTMLDivElement),
    steps = element("install-help", HTMLOListElement),
    install = element("install", HTMLButtonElement),
    banner = element("install-banner", HTMLElement);
  let prompt: InstallEvent | undefined;
  const show = (available: boolean): void => {
    card.hidden = !available;
    banner.hidden = !available || readDismissed();
  };
  if (installed()) return show(false);
  if (appleMobile())
    steps.replaceChildren(
      step(["Tap ", icon(Icon.Share), " Share in Safari."]),
      step(["Choose ", icon(Icon.AddToHome), " Add to Home Screen."]),
      step(["Tap Add."]),
    );
  else if (macSafari()) steps.replaceChildren(step(["In Safari, choose File › Add to Dock."]));
  steps.hidden = !steps.children.length;
  show(steps.children.length > 0);
  addEventListener("beforeinstallprompt", (event) => {
    if (!isInstallEvent(event)) return;
    event.preventDefault();
    prompt = event;
    install.hidden = false;
    show(true);
  });
  addEventListener("appinstalled", () => show(false));
  install.addEventListener(
    "click",
    action(async () => {
      await prompt?.prompt();
      prompt = undefined;
      install.hidden = true;
    }, failure),
  );
  element("install-banner-open", HTMLButtonElement).addEventListener("click", () => {
    if (prompt) install.click();
    else showSettings();
  });
  element("install-banner-close", HTMLButtonElement).addEventListener("click", () => {
    banner.hidden = true;
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* The banner simply returns next time. */
    }
  });
}
