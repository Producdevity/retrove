import { action, element } from "../../ui/dom";
import { connectAppearance } from "../../ui/appearance";
import { formatBytes } from "../../ui/format";
interface InstallEvent extends Event {
  prompt(): Promise<unknown>;
}
function isInstallEvent(event: Event): event is InstallEvent {
  return "prompt" in event && typeof event.prompt === "function";
}
export function connectSettings(failure: (error: unknown) => void): () => Promise<void> {
  connectAppearance(failure);
  const persist = element("persist", HTMLButtonElement);
  const usage = element("storage", HTMLParagraphElement);
  const persistence = element("persistence", HTMLParagraphElement);
  const install = element("install", HTMLButtonElement);
  const help = element("install-help", HTMLParagraphElement);
  let prompt: InstallEvent | undefined;
  const refresh = async (): Promise<void> => {
    const estimate = await navigator.storage.estimate();
    usage.textContent = `${formatBytes(estimate.usage ?? 0)} used of ${formatBytes(estimate.quota ?? 0)} available to this browser.`;
    const supported = typeof navigator.storage.persist === "function";
    const protectedStorage = supported && (await navigator.storage.persisted());
    persist.hidden = !supported || protectedStorage;
    persistence.textContent = protectedStorage
      ? "Storage is protected from automatic browser cleanup."
      : "The browser may remove apps and saves when storage runs low.";
  };
  persist.addEventListener(
    "click",
    action(async () => {
      persist.disabled = true;
      try {
        const granted = await navigator.storage.persist();
        await refresh();
        if (!granted)
          persistence.textContent =
            "The browser did not grant storage protection. Try again after installing Retrove.";
      } finally {
        persist.disabled = false;
      }
    }, failure),
  );
  window.addEventListener("beforeinstallprompt", (event) => {
    if (!isInstallEvent(event)) return;
    event.preventDefault();
    prompt = event;
    install.hidden = false;
  });
  install.addEventListener(
    "click",
    action(async () => {
      if (!prompt) return;
      await prompt.prompt();
      prompt = undefined;
      install.hidden = true;
    }, failure),
  );
  if (
    matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  ) {
    help.textContent = "Retrove is running as an installed app.";
  }
  return refresh;
}
