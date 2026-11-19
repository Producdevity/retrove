import { WorkerControl } from "../../../cpu/worker/channel";
import { serveExecution, type GraphicsService } from "../../../cpu/worker/execution-core";
import type { WorkerPort } from "../../../cpu/worker/protocol";
import type { WorkerGraphics } from "../graphics-owner";
import { CallKind, GraphicsChannel, HeapOperation } from "../graphics-channel";
import { GraphicsServer, type GraphicsFunction } from "../graphics-server";
import { GuestView } from "../guest-view";
import { GraphicsMessage, isGraphicsGates } from "../protocol";

const encoder = new TextEncoder();
const SUM_ARGUMENTS = 6;
const FACTOR = 2;
const LATER_MS = 5;
const PAIR = 2;

/**
 * GL functions without WebGL: `_glSum` adds its six arguments (two from the stack), `_glTwice`
 * doubles r0, `_glLater` doubles r0 asynchronously, `_glString` returns a guest string from the
 * main thread's heap, `_glFail` throws and `_glNothing` returns nothing.
 */
function fakeApi(
  view: GuestView,
  allocate: (size: number) => number,
): Record<string, GraphicsFunction> {
  return {
    _glSum: (a) => Array.from({ length: SUM_ARGUMENTS }, (_, n) => a(n)).reduce((x, y) => x + y, 0),
    _glTwice: (a) => a(0) * FACTOR,
    _glLater: (a) =>
      new Promise((resolve) => {
        setTimeout(() => resolve(a(0) * FACTOR), LATER_MS);
      }),
    _glString: () => {
      const bytes = encoder.encode("worker\0"),
        address = allocate(bytes.length);
      view.write(address, bytes);
      return address;
    },
    _glFail: () => {
      throw new Error("fake GL failure");
    },
    _glNothing: () => undefined,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The graphics service of an execution worker, with the fake GL functions instead of WebGL. */
function fakeService(port: WorkerPort): GraphicsService {
  let owner: WorkerGraphics | undefined, server: GraphicsServer | undefined;
  return {
    receive(message) {
      if (isGraphicsGates(message)) {
        const pairs: [number, number][] = [];
        for (let at = 0; at + 1 < message.gates.length; at += PAIR)
          pairs.push([message.gates[at] ?? 0, message.gates[at + 1] ?? 0]);
        server?.setGates(pairs);
        return true;
      }
      if (!record(message) || message.type !== GraphicsMessage.Start) return false;
      const { channel, control, memory, arena, mask } = message;
      if (!(channel instanceof SharedArrayBuffer) || !(control instanceof SharedArrayBuffer))
        throw new Error("Invalid fake graphics start.");
      if (!(memory instanceof WebAssembly.Memory) || typeof arena !== "number") return true;
      if (typeof mask !== "number") return true;
      const shared = new GraphicsChannel(channel),
        doorbell = new WorkerControl(control),
        view = new GuestView(memory, arena, mask),
        allocate = (size: number) =>
          shared.heap(HeapOperation.Allocate, size, () => doorbell.ring()),
        api = fakeApi(view, allocate);
      const created = new GraphicsServer(shared, view, Object.keys(api), api, (kind, payload) =>
        kind === CallKind.Present && Array.isArray(payload) ? payload.length : 1,
      );
      server = created;
      owner = {
        has: (pc) => created.has(pc),
        local: (pc, thread) => created.local(pc, thread),
        serve: () => created.serve(),
        takeFrame: () => false,
        get asynchronous() {
          return created.asynchronous;
        },
      };
      void created.idle(() => false);
      port.post({ type: GraphicsMessage.Ready, names: created.names });
      return true;
    },
    get owner() {
      return owner;
    },
  };
}

/** An execution worker whose graphics are the fake GL functions. */
export function serveFakeGraphics(port: WorkerPort): void {
  serveExecution(port, fakeService(port));
}
