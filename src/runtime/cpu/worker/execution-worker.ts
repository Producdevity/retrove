import { serveExecution } from "./execution-core";
import type { FailedMessage } from "./protocol";

declare function postMessage(message: FailedMessage): void;

serveExecution({
  post: (message) => {
    postMessage(message);
  },
  listen: (handler) => {
    addEventListener("message", (event: MessageEvent<unknown>) => {
      handler(event.data);
    });
  },
});
