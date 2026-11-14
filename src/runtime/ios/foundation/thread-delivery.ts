import type { HostResult } from "../objc/host";
import { RunLoopMode } from "./ports";
interface Delivery {
  readonly thread: number;
  readonly target: number;
  readonly selector: string;
  readonly argument: number;
  done: boolean;
}
interface DeliveryHost {
  retain(pointer: number): number;
  release(pointer: number): Promise<void>;
  send(self: number, selector: string, args: number[]): Promise<HostResult>;
  currentThread(): number;
}
export class ThreadDeliveries {
  private readonly queue: Delivery[] = [];
  constructor(private readonly host: DeliveryHost) {}
  deliver(thread: number, target: number, selector: string, argument: number, wait: boolean) {
    if (!thread) throw new Error("Selector delivery requires an active NSThread.");
    if (wait && thread === this.host.currentThread())
      return this.host.send(target, selector, [argument]);
    const item = {
      thread,
      target: this.host.retain(target),
      selector,
      argument: this.host.retain(argument),
      done: false,
    };
    this.queue.push(item);
    return wait ? { wait: () => (item.done ? 0 : undefined) } : undefined;
  }
  pending(thread: number, mode: string): boolean {
    return mode === RunLoopMode.Default && this.queue.some((item) => item.thread === thread);
  }
  async pump(thread: number, mode: string): Promise<boolean> {
    if (mode !== RunLoopMode.Default) return false;
    const ready = this.queue.filter((item) => item.thread === thread);
    for (const item of ready) {
      this.queue.splice(this.queue.indexOf(item), 1);
      try {
        await this.host.send(item.target, item.selector, [item.argument]);
      } finally {
        item.done = true;
        await this.host.release(item.target);
        await this.host.release(item.argument);
      }
    }
    return ready.length > 0;
  }
}
