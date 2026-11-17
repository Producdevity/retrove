export async function registerOfflineShell(updateReady: () => void): Promise<void> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.register("/sw.js", {
    type: "module",
    updateViaCache: "none",
  });
  const pending = (): void => {
    if (registration.waiting) updateReady();
  };
  pending();
  registration.addEventListener("updatefound", () => {
    registration.installing?.addEventListener("statechange", pending);
  });
}
