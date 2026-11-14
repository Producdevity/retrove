import { isRecord } from "../domain/validation";
import { expect, test, vi } from "vite-plus/test";
import { installWorkerUpdates } from "./worker-update";
import { UpdateMessage } from "./update-protocol";
class UpdateEvent extends Event {
  readonly pending: Promise<unknown>[] = [];
  constructor(
    readonly data: unknown,
    readonly ports: readonly MessagePort[],
  ) {
    super("message");
  }
  waitUntil(value: Promise<unknown>): void {
    this.pending.push(value);
  }
}
async function update(urls: string[]) {
  let handler: (event: Event) => void = () => {
    throw new Error("No handler");
  };
  const skipWaiting = vi.fn(async () => {}),
    channel = new MessageChannel(),
    post = vi.spyOn(channel.port2, "postMessage");
  installWorkerUpdates(
    { windows: async () => urls.map((url) => ({ url })), skipWaiting },
    (value) => {
      handler = value;
    },
  );
  const event = new UpdateEvent({ type: UpdateMessage.Apply }, [channel.port2]);
  handler(event);
  await Promise.all(event.pending);
  const response: unknown = post.mock.calls[0]?.[0];
  channel.port1.close();
  channel.port2.close();
  return { skipWaiting, response };
}
test("explicit updates activate with library clients", async () => {
  const value = await update(["https://retrove.test/", "https://retrove.test/update.html"]);
  expect(value.skipWaiting).toHaveBeenCalledOnce();
  expect(value.response).toEqual({ type: UpdateMessage.Applied });
});
test("a player window prevents forced update activation", async () => {
  const value = await update(["https://retrove.test/player.html?app=ios%3Atest"]);
  expect(value.skipWaiting).not.toHaveBeenCalled();
  expect(isRecord(value.response) ? value.response.type : undefined).toBe(UpdateMessage.Failed);
  expect(isRecord(value.response) ? value.response.message : undefined).toContain(
    "Return running games",
  );
});
