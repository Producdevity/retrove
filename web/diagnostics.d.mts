import type { Diagnostic } from "./ipa.mjs";
export class DiagnosticRecorder {
  start(name: string, environment: Record<string, unknown>): void;
  snapshot(value: unknown): void;
  event(...args: Parameters<Diagnostic>): void;
  text(): string;
  finish(state: "completed" | "stopped" | "failed", message: string): void;
}
