import { isRecord } from "../domain/validation";
import { withStorageMaintenance } from "../storage/coordination";
import { withArchiveMaintenance } from "../storage/archive-maintenance";
import { UpdateMessage, WORKER_PATH } from "./update-protocol";
const UPDATE_TIMEOUT_MS = 30_000;
export async function updateRegistration(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator))
    throw new Error("This browser does not support app updates.");
  const registration = await navigator.serviceWorker.register(WORKER_PATH, {
    type: "module",
    updateViaCache: "none",
  });
  await registration.update();
  return registration;
}
function activate(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error("The update did not respond. Close other Retrove windows and try again."));
    }, UPDATE_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      const value: unknown = event.data;
      if (!isRecord(value)) return;
      if (value.type !== UpdateMessage.Applied && value.type !== UpdateMessage.Failed) return;
      clearTimeout(timeout);
      channel.port1.close();
      if (value.type === UpdateMessage.Applied) resolve();
      else
        reject(
          new Error(
            typeof value.message === "string" ? value.message : "The update could not be applied.",
          ),
        );
    };
    worker.postMessage({ type: UpdateMessage.Apply }, [channel.port2]);
  });
}
export function applyUpdate(registration: ServiceWorkerRegistration): Promise<void> {
  return withStorageMaintenance(() =>
    withArchiveMaintenance(async () => {
      const worker = registration.waiting;
      if (!worker) throw new Error("No downloaded update is ready yet.");
      const controller = new AbortController();
      const timeout = setTimeout(
        () =>
          controller.abort(new Error("Close other Retrove windows to finish applying the update.")),
        UPDATE_TIMEOUT_MS,
      );
      const controlled = new Promise<void>((resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
          once: true,
        });
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
          signal: controller.signal,
        });
      });
      const finished = controlled.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      try {
        await activate(worker);
        const outcome = await finished;
        if (!outcome.ok) throw outcome.error;
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    }),
  );
}
export function watchUpdates(
  registration: ServiceWorkerRegistration,
  changed: (ready: boolean) => void,
): void {
  const update = () => changed(Boolean(registration.waiting));
  registration.addEventListener("updatefound", () => {
    registration.installing?.addEventListener("statechange", update);
    update();
  });
  update();
}
