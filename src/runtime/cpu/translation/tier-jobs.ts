import type { Executable } from "./executable";
import { relativeLayout, type StateLayout } from "./layout";
import { STOP_PC } from "./tier-options";
import { buildJob, type CodeSnapshot, type TranslationJob } from "./translation-job";
import type { FunctionRange } from "./translation-types";
import { moduleSlot } from "./translation-store";
import {
  profileBatches,
  type ProfileRecorder,
  type TranslationProfile,
} from "./translation-profile";
import type { ReplayLimits } from "./translation-profile";

/** Builds translation jobs with arena-relative addresses, so their modules are valid at any base. */
export class TierJobs {
  constructor(
    private readonly layout: () => StateLayout,
    private readonly executable: () => Executable | undefined,
    private readonly shared: boolean,
  ) {}
  build(
    functions: readonly FunctionRange[],
    entries: readonly number[],
    pages: readonly CodeSnapshot[],
    cacheKey?: string,
  ): TranslationJob {
    const executable = this.executable(),
      code = executable && { start: executable.codeStart, end: executable.codeEnd };
    return buildJob({
      functions,
      entries,
      pages,
      layout: relativeLayout(this.layout()),
      stopPC: STOP_PC,
      code: pages.length ? undefined : code,
      cacheKey,
      shared: this.shared,
    });
  }
  /** One job per batch of the functions an earlier launch translated. */
  replay(
    profile: TranslationProfile,
    recorder: ProfileRecorder,
    executable: Executable,
    limits: ReplayLimits,
    cache: string | undefined,
  ): TranslationJob[] {
    return profileBatches(profile, executable, limits).map((functions, index) =>
      this.build(functions, recorder.entriesOf(functions), [], cache && moduleSlot(cache, index)),
    );
  }
}
