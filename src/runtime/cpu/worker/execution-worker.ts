import { graphicsService } from "../../graphics/remote/graphics-service";
import type { FromGraphics } from "../../graphics/remote/protocol";
import { serveExecution } from "./execution-core";
import type { FailedMessage, WakeMessage, WorkerPort } from "./protocol";

declare function postMessage(message: FailedMessage | WakeMessage | FromGraphics): void;

const port: WorkerPort = {
  post: (message) => {
    postMessage(message);
  },
  listen: (handler) => {
    addEventListener("message", (event: MessageEvent<unknown>) => {
      handler(event.data);
    });
  },
};
serveExecution(port, graphicsService(port));
