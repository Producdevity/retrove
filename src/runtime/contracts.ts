import type { ApplicationMetadata, Platform } from "../domain/application";

export const SessionState = {
  Ready: "ready",
  Loading: "loading",
  Running: "running",
  Suspended: "suspended",
  Stopped: "stopped",
  Failed: "failed",
} as const;
export type SessionState = (typeof SessionState)[keyof typeof SessionState];
export const PointerPhase = {
  Began: "began",
  Moved: "moved",
  Ended: "ended",
  Cancelled: "cancelled",
} as const;
export type PointerPhase = (typeof PointerPhase)[keyof typeof PointerPhase];
export interface GuestPointer {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly phase: PointerPhase;
  readonly timestamp: number;
}
export interface SessionSnapshot {
  readonly state: SessionState;
  readonly presentedFrames: number;
  readonly elapsedMilliseconds: number;
  readonly error: string | null;
}
export interface RuntimeSession {
  readonly platform: Platform;
  readonly metadata: ApplicationMetadata;
  start(): Promise<void>;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  flushSaves(): Promise<void>;
  pointers(events: readonly GuestPointer[]): void;
}
