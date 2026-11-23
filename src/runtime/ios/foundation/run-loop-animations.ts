import { doubleFromBits } from "../abi/scalars";
import { BlockField } from "../threads/block-runtime";
import type { RunLoopHost } from "./run-loop-host";

const MS_PER_SECOND = 1000;
const COMPLETION_FINISHED = 1;
const Animate = { DurationLow: 0, DurationHigh: 1, DelayLow: 2, DelayHigh: 3 } as const;
const WithDelay = { Options: 4, Changes: 5, Completion: 6 } as const;
const Plain = { Changes: 2, Completion: 3 } as const;
const Short = { Changes: 2 } as const;
const UIVIEW = "UIView";

interface PendingCompletion {
  readonly block: number;
  readonly at: number;
}

export class ViewAnimations {
  private readonly completions: PendingCompletion[] = [];
  constructor(private readonly host: RunLoopHost) {
    const duration = (a: (index: number) => number): number =>
      doubleFromBits(a(Animate.DurationLow), a(Animate.DurationHigh));
    host.method(UIVIEW, true, "animateWithDuration:delay:options:animations:completion:", (_, a) =>
      this.animate(
        duration(a),
        doubleFromBits(a(Animate.DelayLow), a(Animate.DelayHigh)),
        a(WithDelay.Options),
        a(WithDelay.Changes),
        a(WithDelay.Completion),
      ),
    );
    host.method(UIVIEW, true, "animateWithDuration:animations:completion:", (_, a) =>
      this.animate(duration(a), 0, 0, a(Plain.Changes), a(Plain.Completion)),
    );
    host.method(UIVIEW, true, "animateWithDuration:animations:", (_, a) =>
      this.animate(duration(a), 0, 0, a(Short.Changes), 0),
    );
  }

  get pending(): number {
    return this.completions.length;
  }

  // UIView immediately applies model changes. The completion block runs on
  // the main run loop after both the requested delay and the duration.
  private async animate(
    seconds: number,
    delay: number,
    options: number,
    changes: number,
    completion: number,
  ): Promise<void> {
    const { host } = this;
    const service = host.getDispatch();
    const saved = completion ? await service.copy(completion) : 0;
    try {
      if (changes)
        await host.withAnimation(seconds, delay, options, () =>
          host.callGuest(host.read(changes + BlockField.Invoke), [changes]),
        );
      if (saved)
        this.completions.push({
          block: saved,
          at: performance.now() + Math.max(0, seconds + delay) * MS_PER_SECOND,
        });
    } catch (error) {
      if (saved) await service.release(saved);
      throw error;
    }
  }

  async pumpDue(now: number): Promise<void> {
    const { host } = this;
    for (const completion of this.completions.slice()) {
      if (completion.at > now) continue;
      this.completions.splice(this.completions.indexOf(completion), 1);
      try {
        await host.callGuest(host.read(completion.block + BlockField.Invoke), [
          completion.block,
          COMPLETION_FINISHED,
        ]);
      } finally {
        await host.getDispatch().release(completion.block);
      }
    }
  }
}
