import type { CodeBudget } from "./code-budget";
import type { GuestPages } from "./guest-pages";
import {
  compileTranslation,
  i32Global,
  installTranslation,
  instantiateTranslation,
  instantiateTranslationNow,
  reserveTranslation,
  setExport,
  type Instantiated,
  type TranslationImports,
} from "./install";
import type { LabelAreas } from "./label-areas";
import type { StateLayout } from "./layout";
import { missingFunction } from "./missing-function";
import type { CompiledModule, TierOptions } from "./tier-options";
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
  /** Host address of the state block that instances installed here run on. */
  readonly state: number;
  readonly layout: () => StateLayout;
  readonly labels: LabelAreas;
  readonly budget: CodeBudget;
  readonly statistics: TierStatistics;
  readonly translator: Translator;
  /** The module sink and `env.host` handler. */
  readonly options: Pick<TierOptions, "modules" | "host">;
}
const noHost = (): number => 0;

/** Turns jobs into installed functions: translation, a label block, compilation and table slots. */
export class ModuleInstaller {
  readonly #arena: WebAssembly.Global;
  readonly #state: WebAssembly.Global;
  /** Modules compiled for execution workers whose table slots still hold `#missing`, by slot. */
  readonly #deferred = new Map<number, CompiledModule>();
  #missing: WebAssembly.ExportValue | undefined;
  constructor(private readonly parts: InstallerParts) {
    this.#arena = i32Global(parts.pages.arena);
    this.#state = i32Global(parts.state);
  }
  #env(labels: number): TranslationImports {
    const { memory, table } = this.parts;
    return {
      memory,
      table,
      arena: this.#arena,
      labels: i32Global(labels),
      state: this.#state,
      host: this.parts.options.host ?? noHost,
    };
  }
  #imports(translation: Translation): { block: number; imports: TranslationImports } {
    const block = this.parts.labels.allocate(labelBlockBytes(translation));
    if (block === undefined) throw new Error("Translated label area is full.");
    return { block, imports: this.#env(block) };
  }
  #install(translation: Translation, compiled: Instantiated, block: number): InstalledModule {
    const { table, pages, budget } = this.parts,
      modules = this.parts.options.modules;
    budget.add(translation.wasm.length);
    const slots = installTranslation(table, pages.bytes, compiled.exports, translation, block);
    modules?.record({
      module: compiled.module,
      labels: block,
      slots,
      exports: translation.functions.map((translated) => translated.exportName),
    });
    return { translation, slots };
  }
  /** Frees every label block; other threads first stop running modules that use them. */
  reset(): void {
    this.#deferred.clear();
    this.parts.options.modules?.flush();
    this.parts.labels.reset();
  }
  /** Translates on the worker and compiles off the main thread; undefined when `current` turns false. */
  async compile(job: TranslationJob, current: () => boolean): Promise<InstalledModule | undefined> {
    const statistics = this.parts.statistics,
      { translation, elapsedMs, cached } = await this.parts.translator.translate(job);
    statistics.translateMs += elapsedMs;
    if (cached) statistics.cachedModules++;
    statistics.unsupported += translation.statistics.unsupported;
    const { block, imports } = this.#imports(translation);
    const compiled = await instantiateTranslation(translation, imports, statistics);
    return current() ? this.#install(translation, compiled, block) : undefined;
  }
  /**
   * Translates and compiles on the calling thread. With `forWorker` and execution workers on, the
   * module is only compiled and handed to the module sink: the main thread instantiates it when
   * it first enters one of its slots, which hold the missing-code function until then.
   */
  now(job: TranslationJob, forWorker = false): InstalledModule {
    const statistics = this.parts.statistics,
      { translation, elapsedMs } = runJob(job, (address) => this.parts.pages.word(address));
    statistics.translateMs += elapsedMs;
    statistics.unsupported += translation.statistics.unsupported;
    const { block, imports } = this.#imports(translation);
    if (forWorker && this.parts.options.modules)
      return this.#defer(translation, compileTranslation(translation, statistics), block);
    return this.#install(
      translation,
      instantiateTranslationNow(translation, imports, statistics),
      block,
    );
  }
  #defer(translation: Translation, module: WebAssembly.Module, block: number): InstalledModule {
    const { table, pages, budget, statistics } = this.parts;
    this.#missing ??= missingFunction(this.#env(0), this.parts.layout());
    budget.add(translation.wasm.length);
    const slots = reserveTranslation(table, pages.bytes, translation, block, this.#missing);
    const compiled = {
      module,
      labels: block,
      slots,
      exports: translation.functions.map((translated) => translated.exportName),
    };
    for (const slot of slots) this.#deferred.set(slot, compiled);
    this.parts.options.modules?.record(compiled);
    statistics.deferredModules++;
    return { translation, slots };
  }
  /** Instantiates the deferred module owning table slot `entry - 1` on this thread; returns `entry`. */
  materialize(entry: number): number {
    const compiled = this.#deferred.get(entry - 1);
    if (!compiled) return entry;
    const { exports } = new WebAssembly.Instance(compiled.module, {
      env: this.#env(compiled.labels),
    });
    compiled.slots.forEach((owned, offset) => {
      this.#deferred.delete(owned);
      setExport(this.parts.table, owned, exports, compiled.exports[offset] ?? "");
    });
    this.parts.statistics.materializedModules++;
    return entry;
  }
}
