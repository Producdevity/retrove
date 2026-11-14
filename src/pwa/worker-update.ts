import { isRecord } from "../domain/validation";
import { UpdateMessage } from "./update-protocol";
interface WindowClient {
  readonly url: string;
}
interface UpdateHost {
  windows(): Promise<readonly WindowClient[]>;
  skipWaiting(): Promise<void>;
}
interface UpdateEvent extends Event {
  readonly data: unknown;
  readonly ports: readonly MessagePort[];
  waitUntil(task: Promise<unknown>): void;
}
function isUpdateEvent(event: Event): event is UpdateEvent {
  return (
    "data" in event &&
    "ports" in event &&
    Array.isArray(event.ports) &&
    "waitUntil" in event &&
    typeof event.waitUntil === "function"
  );
}
export function installWorkerUpdates(
  host: UpdateHost,
  listen: (handler: (event: Event) => void) => void,
): void {
  listen((event) => {
    if (!isUpdateEvent(event) || !isRecord(event.data) || event.data.type !== UpdateMessage.Apply)
      return;
    const port = event.ports[0];
    if (!port) return;
    event.waitUntil(
      (async () => {
        try {
          const windows = await host.windows();
          if (
            windows.some((client) => /^\/player(?:\.html)?\/?$/.test(new URL(client.url).pathname))
          )
            throw new Error(
              "Return running games to the library and close their player windows before updating.",
            );
          await host.skipWaiting();
          port.postMessage({ type: UpdateMessage.Applied });
        } catch (error) {
          port.postMessage({
            type: UpdateMessage.Failed,
            message: error instanceof Error ? error.message : "The update could not be applied.",
          });
        }
      })(),
    );
  });
}
