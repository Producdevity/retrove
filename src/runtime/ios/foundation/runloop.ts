import { ViewAnimations } from "./run-loop-animations";
import type { RunLoopHost } from "./run-loop-host";
import { SelectorQueue } from "./run-loop-perform";
import { RunLoopTimers } from "./run-loop-timers";

export interface RunLoop {
  later(run: () => Promise<void> | void): void;
  unscheduleTimer(pointer: number): Promise<void>;
  pollThread(id: number, mode: string): Promise<boolean>;
  hasThreadSource(id: number, mode: string): boolean;
  pending(): number;
  pump(): Promise<void>;
}

export function foundationRunLoop(host: RunLoopHost): RunLoop {
  const timers = new RunLoopTimers(host);
  const selectors = new SelectorQueue(host);
  const animations = new ViewAnimations(host);
  return {
    later: (run) => {
      selectors.calls.push({ run, at: 0 });
    },
    unscheduleTimer: (pointer) => timers.unschedule(pointer),
    pollThread: (id, mode) => selectors.pollThread(id, mode),
    hasThreadSource: (id, mode) => selectors.hasThreadSource(id, mode),
    pending: () => timers.scheduled.size + selectors.calls.length + animations.pending,
    async pump() {
      const now = performance.now();
      await selectors.pumpDue(now);
      await animations.pumpDue(now);
      await timers.fireDue(now);
    },
  };
}
