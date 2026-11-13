import { action, element } from "../../ui/dom";
import { formatBytes } from "../../ui/format";
interface InstallEvent extends Event {
  prompt(): Promise<unknown>;
}
function isInstallEvent(event: Event): event is InstallEvent {
  return "prompt" in event && typeof event.prompt === "function";
}
export function connectSettings(failure: (error: unknown) => void): () => Promise<void> {
  const usage = element("storage", HTMLParagraphElement);
  const persistence = element("persistence", HTMLParagraphElement);
  const install = element("install", HTMLButtonElement);
  const help = element("install-help", HTMLParagraphElement);
  let prompt: InstallEvent | undefined;
  const refresh = async (): Promise<void> => {
    const estimate = await navigator.storage.estimate();
    usage.textContent = `${formatBytes(estimate.usage ?? 0)} used of ${formatBytes(estimate.quota ?? 0)} available to this browser.`;
    persistence.textContent = (await navigator.storage.persisted())
      ? "Persistent storage is enabled."
      : "The browser may reclaim local storage when the device runs low on space.";
  };
  element("persist", HTMLButtonElement).addEventListener(
    "click",
    action(async () => {
      await navigator.storage.persist();
      await refresh();
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
