import type { GraphicsService } from "../../cpu/worker/execution-core";
import { ExecutionMessage, type WorkerPort } from "../../cpu/worker/protocol";
import { GraphicsOwner } from "./graphics-owner";
import { GraphicsMessage, isGraphicsGates, isGraphicsStart } from "./protocol";

const PAIR = 2;

/** The graphics messages of an execution worker: creates the GL owner when the context moves here. */
export function graphicsService(port: Pick<WorkerPort, "post">): GraphicsService {
  let owner: GraphicsOwner | undefined;
  return {
    receive(message) {
      if (isGraphicsStart(message)) {
        try {
          const created = new GraphicsOwner(message, (report) => port.post(report));
          owner = created;
          port.post({ type: GraphicsMessage.Ready, names: created.server.names });
          void created.server.idle(() => false);
        } catch (error) {
          port.post({ type: ExecutionMessage.Failed, message: String(error) });
        }
        return true;
      }
      if (!isGraphicsGates(message)) return false;
      const pairs: (readonly [number, number])[] = [];
      for (let at = 0; at + 1 < message.gates.length; at += PAIR)
        pairs.push([message.gates[at] ?? 0, message.gates[at + 1] ?? 0]);
      owner?.server.setGates(pairs);
      return true;
    },
    get owner() {
      return owner;
    },
  };
}
