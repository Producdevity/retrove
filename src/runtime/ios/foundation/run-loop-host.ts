import type { GuestMemory } from "../../memory/guest-memory";
import type { FoundationHost, HostResult } from "../objc/host";

export interface SelectorCall {
  readonly target: number;
  readonly name: string;
  readonly arg: number;
  readonly at: number;
  readonly delayed?: boolean;
  done?: boolean;
}
export interface DeferredRun {
  readonly run: () => Promise<void> | void;
  readonly at: number;
}
export type QueuedCall = SelectorCall | DeferredRun;
export interface RunLoopHost {
  readonly cpu: GuestMemory;
  readonly hostClass: FoundationHost["hostClass"];
  readonly method: FoundationHost["method"];
  readonly names: ReadonlyMap<string, number>;
  readonly alloc: FoundationHost["alloc"];
  readonly autorelease: FoundationHost["autorelease"];
  readonly retain: FoundationHost["retain"];
  readonly release: FoundationHost["release"];
  readonly destroy: FoundationHost["destroy"];
  readonly send: (self: number, selector: string, args?: number[]) => Promise<HostResult>;
  readonly threads: { readonly funcs: { readonly _pthread_self: () => number } } | undefined;
  readonly read: (address: number) => number;
  readonly callGuest: (target: number, args: number[]) => Promise<number>;
  readonly getDispatch: () => {
    copy(block: number): Promise<number>;
    release(block: number): Promise<void>;
  };
  readonly withAnimation: (
    seconds: number,
    delay: number,
    options: number,
    body: () => Promise<unknown>,
  ) => Promise<unknown>;
  readonly threadIdentity: (thread: number) => number;
}
