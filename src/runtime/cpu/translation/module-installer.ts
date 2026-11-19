import type { CodeBudget } from "./code-budget";
import type { GuestPages } from "./guest-pages";
import {
  i32Global,
  installTranslation,
  instantiateTranslation,
  instantiateTranslationNow,
} from "./install";
import type { LabelAreas } from "./label-areas";
import type { TierStatistics } from "./tier-statistics";
import { labelBlockBytes, runJob, type TranslationJob } from "./translation-job";
import type { Translation } from "./translation-types";
import type { Translator } from "./translator";

export interface InstalledModule {
  readonly translation: Translation;
  /** Function table slot of each translated function, in order. */
  readonly slots: readonly number[];
}
interface InstallerParts {
  readonly memory: WebAssembly.Memory;
  readonly table: WebAssembly.Table;
  readonly pages: GuestPages;
  readonly labels: LabelAreas;
  readonly budget: CodeBudget;
  readonly statistics: TierStatistics;
  readonly translator: Translator;
}

/** Turns jobs into installed functions: translation, a label block, compilation and table slots. */
export class ModuleInstaller {
  readonly #arena: WebAssembly.Global;
  constructor(private readonly parts: InstallerParts) {
    this.#arena = i32Global(parts.pages.arena);
  }
  #imports(translation: Translation) {
    const block = this.parts.labels.allocate(labelBlockBytes(translation));
    if (block === undefined) throw new Error("Translated label area is full.");
    const { memory, table } = this.parts;
    return { block, imports: { memory, table, arena: this.#arena, labels: i32Global(block) } };
  }
  #install(translation: Translation, exports: WebAssembly.Exports, block: number): InstalledModule {
    const { table, pages, budget } = this.parts;
    budget.add(translation.wasm.length);
    return {
      translation,
      slots: installTranslation(table, pages.bytes, exports, translation, block),
    };
  }
  /** Translates on the worker and compiles off the main thread; undefined when `current` turns false. */
  async compile(job: TranslationJob, current: () => boolean): Promise<InstalledModule | undefined> {
    const statistics = this.parts.statistics,
      { translation, elapsedMs, cached } = await this.parts.translator.translate(job);
    statistics.translateMs += elapsedMs;
    if (cached) statistics.cachedModules++;
    statistics.unsupported += translation.statistics.unsupported;
    const { block, imports } = this.#imports(translation);
    const exports = await instantiateTranslation(translation, imports, statistics);
    return current() ? this.#install(translation, exports, block) : undefined;
  }
  /** Translates and compiles on the calling thread. */
  now(job: TranslationJob): InstalledModule {
    const statistics = this.parts.statistics,
      { translation, elapsedMs } = runJob(job, (address) => this.parts.pages.word(address));
    statistics.translateMs += elapsedMs;
    statistics.unsupported += translation.statistics.unsupported;
    const { block, imports } = this.#imports(translation);
    return this.#install(
      translation,
      instantiateTranslationNow(translation, imports, statistics),
      block,
    );
  }
}
