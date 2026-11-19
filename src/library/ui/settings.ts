import { connectStorageManagement } from "./storage/management";
import type { StorageManagement } from "../../storage/management/service";
import { action, element } from "../../ui/dom";
import { connectAppearance } from "../../ui/appearance";
import { connectCpuMethod } from "./cpu-method";

function connectPersistence(failure: (error: unknown) => void): () => Promise<void> {
  const persist = element("persist", HTMLButtonElement);
  const value = element("persistence", HTMLSpanElement);
  const status = element("storage-status", HTMLParagraphElement);
  const supported = typeof navigator.storage.persist === "function";
  const refresh = async (): Promise<void> => {
    const kept = supported && (await navigator.storage.persisted());
    value.textContent = supported ? (kept ? "On" : "Off") : "Unavailable";
    persist.hidden = !supported || kept;
  };
  persist.addEventListener(
    "click",
    action(async () => {
      persist.disabled = true;
      try {
        const granted = await navigator.storage.persist();
        await refresh();
        if (!granted)
          status.textContent =
            "The browser declined. Installing Retrove usually lets it keep data.";
      } finally {
        persist.disabled = false;
      }
    }, failure),
  );
  return refresh;
}

export function connectSettings(
  failure: (error: unknown) => void,
  manager: StorageManagement,
  changed: () => Promise<void>,
): () => Promise<void> {
  connectAppearance(failure);
  const cpuMethod = connectCpuMethod(failure);
  const storage = connectStorageManagement(manager, changed, failure);
  const persistence = connectPersistence(failure);
  return async () => {
    cpuMethod();
    await Promise.all([storage(), persistence()]);
  };
}
