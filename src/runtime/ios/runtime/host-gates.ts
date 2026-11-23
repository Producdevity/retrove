import type { ImportCounter, ImportMetrics } from "../../diagnostics/import-metrics";
import { GuestLayout } from "../../memory/guest-layout";
import type { GuestArguments } from "../objc/host";

const GATE_WORD = 4;
export const GATES = GuestLayout.Gates;
export const GATE_BYTES = GuestLayout.GateBytes;
/** The return address of every guest call the runtime makes: the gate area's last word. */
export const RETURN = GATES + GATE_BYTES - GATE_WORD;

/** A host implementation of a guest import; its result settles the guest call. */
export type HostFunction = (args: GuestArguments) => unknown;
export interface HostBinding {
  readonly name: string;
  readonly library?: string | null | undefined;
}
export interface HostStub {
  readonly fn: HostFunction | undefined;
  readonly binding: HostBinding;
  readonly counter: ImportCounter;
  readonly graphics: boolean;
  /** The import's name as reports show it, formatted at its first call. */
  symbol?: string;
}

/** One guest-callable gate address per imported library function. */
export class HostGates {
  readonly #gates = new Map<string, number>();
  readonly stubs = new Map<number, HostStub>();
  constructor(private readonly metrics: ImportMetrics) {}
  readonly hostGate = (binding: HostBinding, fn: HostFunction | undefined): number => {
    const key = (binding.library || "") + "\0" + binding.name;
    const existing = this.#gates.get(key);
    if (existing !== undefined) return existing;
    const at = GATES + this.#gates.size * GATE_WORD;
    if (at >= RETURN) throw Error("Too many imported functions");
    this.#gates.set(key, at);
    this.stubs.set(at, {
      fn,
      binding,
      counter: this.metrics.register(binding.name),
      graphics: binding.name.startsWith("_gl"),
    });
    return at;
  };
}
