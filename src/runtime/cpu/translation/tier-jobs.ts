import type { Executable } from "./executable";
import type { LabelAreas } from "./label-areas";
import { relativeLayout, type StateLayout } from "./layout";
import { STOP_PC } from "./tier-options";
import { buildJob, type CodeSnapshot, type TranslationJob } from "./translation-job";
import type { FunctionRange } from "./translation-types";

/** Builds translation jobs with arena-relative addresses, so their modules are valid at any base. */
export class TierJobs {
  constructor(
    private readonly arena: number,
    private readonly labels: LabelAreas,
    private readonly layout: () => StateLayout,
    private readonly executable: () => Executable | undefined,
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
      labelAddress: (range) => this.labels.address(range, code) - this.arena,
      cacheKey,
    });
  }
}
