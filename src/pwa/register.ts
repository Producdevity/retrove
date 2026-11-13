export async function registerOfflineShell(report: (message: string) => void): Promise<void> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.register("/sw.js", {
    type: "module",
    updateViaCache: "none",
  });
  const pending = (): void => {
    if (registration.waiting) report("An update is ready. Close all Retrove windows to apply it.");
  };
  pending();
  registration.addEventListener("updatefound", () => {
    registration.installing?.addEventListener("statechange", pending);
  });
}
