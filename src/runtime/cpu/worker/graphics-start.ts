import { GraphicsChannel } from "../../graphics/remote/graphics-channel";
import { GraphicsLink, type GraphicsLinkHost } from "../../graphics/remote/graphics-link";
import { GraphicsMessage, isFromGraphics } from "../../graphics/remote/protocol";
import { isFailedMessage, type ExecutionPort } from "./protocol";

export interface GraphicsOptions extends Omit<GraphicsLinkHost, "wake" | "gates"> {
  /** The display's OffscreenCanvas, already transferred from the page. */
  readonly canvas: Transferable;
  /** Called when the worker loses its WebGL context. */
  lost(): void;
  /** Guest words for the glGetError and bind fast paths, allocated by the main thread. */
  readonly errorFlag: number;
  readonly bindingShadow: number;
  diagnostic(level: string, area: string, message: string, details?: unknown): void;
}
export interface SharedGuest {
  readonly memory: WebAssembly.Memory;
  readonly control: SharedArrayBuffer;
  readonly arena: number;
  readonly mask: number;
}

/**
 * Moves the WebGL context to an execution worker: sends it the canvas and waits until it has
 * created the context and listed its GL functions. `listen` receives the worker's messages.
 */
export function startGraphics(
  port: ExecutionPort,
  listen: (handler: (message: unknown) => void) => void,
  guest: SharedGuest,
  options: GraphicsOptions,
  wake: () => void,
): Promise<GraphicsLink> {
  const channel = new GraphicsChannel();
  const host: GraphicsLinkHost = {
    heap: options.heap,
    idle: options.idle,
    wake,
    gates: (gates) => port.post({ type: GraphicsMessage.Gates, gates }),
  };
  return new Promise((resolve, reject) => {
    let started = false;
    listen((message) => {
      if (isFailedMessage(message) && !started)
        reject(new Error(`Graphics worker: ${message.message}`));
      if (!isFromGraphics(message)) return;
      if (message.type === GraphicsMessage.Ready) {
        started = true;
        resolve(new GraphicsLink(channel, message.names, host));
      } else if (message.type === GraphicsMessage.Diagnostic)
        options.diagnostic(message.level, message.area, message.message, message.details);
      else options.lost();
    });
    port.post(
      {
        type: GraphicsMessage.Start,
        canvas: options.canvas,
        channel: channel.buffer,
        errorFlag: options.errorFlag,
        bindingShadow: options.bindingShadow,
        ...guest,
      },
      [options.canvas],
    );
  });
}
