import { PageBytes, StateBytes, stateLayout, type StateLayout } from "./layout";
import type { FunctionRange, Translation } from "./translate";
import { buildJob, runJob, type CodeSnapshot, type TranslationJob } from "./translation-job";
import { Translator } from "./translator";
import { installTranslation, instantiateTranslation } from "./install";
import { GuestPages } from "./guest-pages";
import { ForeignPages, ForeignQueue, FOREIGN_SLOTS } from "./foreign-pages";
import { discoverExecutable, functionAt, type Executable } from "./executable";
import { emptyStatistics, recordError, type TierStatistics } from "./tier-statistics";
import { collectBatch } from "./collect";
import { HotFunctions } from "./hot-functions";
import { CodeBudget } from "./code-budget";
import { FunctionIndex } from "./function-index";
import { moduleSlot } from "./translation-store";
import { ProfileRecorder, profileBatches } from "./translation-profile";
import { Alignment, Batch, Coalesce, PROFILE_SAVE_MS, STOP_PC } from "./tier-options";
import type { TierModule, TierOptions } from "./tier-options";

export type { TierModule, TierOptions } from "./tier-options";

const WORD_BYTES = 4;
const THUMB_BIT = 1;
const pageOf = (address: number): number => Math.floor(address / PageBytes);
export class TranslatedTier {
  readonly table = new WebAssembly.Table({ element: "anyfunc", initial: 0 });
  readonly pages: GuestPages;
  readonly statistics: TierStatistics = emptyStatistics();
  /** Guest PCs that must stay on the interpreter (host traps). */
  excluded: (pc: number) => boolean = () => false;
  #layout: StateLayout;
  readonly #module: TierModule;
  readonly #memory: WebAssembly.Memory;
  readonly #foreign: ForeignPages;
  readonly #allocations: number[] = [];
  readonly #translated = new Set<number>();
  readonly #queued = new Set<number>();
  readonly #hot = new HotFunctions();
  readonly #budget: CodeBudget;
  readonly #index = new FunctionIndex(
    () => this.pages.view,
    () => this.#layout.index,
  );
  /** Profiled functions whose replay job is built but not installed yet. */
  readonly #planned = new Set<number>();
  readonly #replay: TranslationJob[] = [];
  readonly #profile: ProfileRecorder;
  readonly #options: TierOptions;
  readonly #foreignQueue = new ForeignQueue();
  #executable: Executable | undefined;
  #discovered = false;
  #working = false;
  #closed = false;
  /** Bumped when executable code is written, so in-flight jobs built from older bytes are dropped. */
  #epoch = 0;
  readonly #translator = new Translator((job) =>
    runJob(job, (address) => this.pages.word(address)),
  );
  constructor(module: TierModule, options: TierOptions = {}) {
    this.#module = module;
    this.#options = options;
    this.#profile = new ProfileRecorder(options.profile);
    this.#memory = module.getTciMemory();
    this.#budget = new CodeBudget((pointer) => module._free(pointer));
    const state = this.#allocate(StateBytes, Alignment.State);
    this.pages = new GuestPages(
      module,
      this.#memory,
      this.#allocate(GuestPages.tableBytes, Alignment.Table),
    );
    const foreign = this.#allocate(ForeignPages.bytes, Alignment.Index);
    this.#foreign = new ForeignPages(foreign, () => this.pages.view);
    this.#layout = {
      ...stateLayout(state, this.pages.table, { base: 0, start: 0, end: 0 }),
      foreign: { base: foreign, slots: FOREIGN_SLOTS },
    };
    this.statistics.translator = this.#translator.kind;
  }
  get layout(): StateLayout {
    return this.#layout;
  }
  #allocate(bytes: number, alignment: number, owner = this.#allocations): number {
    const raw = this.#module._malloc(bytes + alignment);
    if (!raw) throw new Error("Unable to allocate translated-code memory.");
    owner.push(raw);
    const aligned = Math.ceil(raw / alignment) * alignment;
    this.#module.HEAPU8.fill(0, aligned, aligned + bytes);
    return aligned;
  }
  #discover(): void {
    this.#discovered = true;
    const executable = discoverExecutable(this.pages.regions, {
      word: (address) => this.pages.word(address),
      read: (address, length) => {
        const bytes = new Uint8Array(length);
        return this.pages.read(address, bytes) ? bytes : new Uint8Array(0);
      },
    });
    if (!executable) return;
    this.#executable = executable;
    const span = executable.codeEnd - executable.codeStart;
    const base = this.#allocate(FunctionIndex.bytes(span), Alignment.Index);
    this.#layout = {
      ...this.#layout,
      index: { base, start: executable.codeStart, end: executable.codeEnd },
    };
    for (const snapshot of this.pages.snapshots(executable.codeStart, executable.codeEnd))
      this.#translator.setCode(snapshot);
    if (!this.#options.profile) return;
    const cache = this.#options.cache;
    profileBatches(this.#options.profile, executable, Batch).forEach((functions, index) => {
      const slot = cache && moduleSlot(cache, index);
      this.#replay.push(this.#job(functions, this.#profile.entriesOf(functions), [], slot));
      for (const range of functions) this.#planned.add(range.start);
    });
    this.statistics.replayModules = this.#replay.length;
    this.#schedule();
  }
  #handled(start: number): boolean {
    return this.#translated.has(start) || this.#planned.has(start);
  }
  /** Function table slot + 1 for a guest PC, 0 when not translated. */
  entry(pc: number): number {
    const inside = this.#index.get(pc);
    if (inside !== undefined) return inside;
    if (pc & (WORD_BYTES - 1)) return 0;
    return this.#foreign.entry(pageOf(pc));
  }
  /** Retranslates the function containing `pc` with `pc` as an extra entry label. */
  discoveredEntry(pc: number): void {
    const range = functionAt(this.#executable, pc);
    if (!range) return;
    if (!this.#profile.addEntry(range.start, pc)) return;
    this.#translated.delete(range.start);
    this.#planned.delete(range.start);
    this.#queued.add(range.start);
    this.statistics.retranslations++;
    this.#schedule();
  }
  /** Queues the function (or foreign page) containing a PC the interpreter is about to run. */
  note(pc: number): void {
    if (!this.#discovered) this.#discover();
    const executable = this.#executable;
    if (!executable) return;
    if (
      !(pc & (WORD_BYTES - 1)) &&
      (pc < executable.codeStart || pc >= executable.codeEnd) &&
      !this.excluded(pc) &&
      this.pages.word(pc) !== undefined
    ) {
      if (this.#foreignQueue.note(pageOf(pc), pc)) this.#schedule();
      return;
    }
    const range = functionAt(executable, pc);
    const skip = !range || this.#handled(range.start) || this.#queued.has(range.start);
    if (skip || !this.#hot.enter(range.start)) return;
    this.#queued.add(range.start);
    this.statistics.pendingFunctions = this.#queued.size;
    this.#schedule();
  }
  #schedule(): void {
    const waiting = this.#queued.size + this.#foreignQueue.size + this.#replay.length;
    if (this.#working || this.#closed || !waiting) return;
    this.#working = true;
    const urgent = this.#replay.length || this.#queued.size >= Coalesce.Functions;
    const run = async (): Promise<void> => {
      await this.#batch().catch((error: unknown) => recordError(this.statistics, error));
      this.#working = false;
      this.#schedule();
    };
    setTimeout(() => void run(), urgent ? 0 : Coalesce.DelayMs);
  }
  #job(
    functions: readonly FunctionRange[],
    entries: readonly number[],
    pages: readonly CodeSnapshot[],
    cacheKey?: string,
  ): TranslationJob {
    const executable = this.#executable;
    return buildJob({
      functions,
      entries,
      pages,
      layout: this.#layout,
      stopPC: STOP_PC,
      code:
        executable && !pages.length
          ? { start: executable.codeStart, end: executable.codeEnd }
          : undefined,
      allocate: (bytes) => this.#allocate(bytes, Alignment.Index, this.#budget.labels),
      cacheKey,
    });
  }
  /** Translates and compiles a job; undefined when the tier closed or code changed meanwhile. */
  async #compile(
    job: TranslationJob,
  ): Promise<{ translation: Translation; slots: number[] } | undefined> {
    const epoch = this.#epoch,
      { translation, elapsedMs, cached } = await this.#translator.translate(job);
    this.statistics.translateMs += elapsedMs;
    if (cached) this.statistics.cachedModules++;
    this.statistics.unsupported += translation.statistics.unsupported;
    const exports = await instantiateTranslation(
      translation,
      { memory: this.#memory, table: this.table },
      this.statistics,
    );
    if (this.#closed || epoch !== this.#epoch) return undefined;
    this.#budget.add(translation.wasm.length);
    return {
      translation,
      slots: installTranslation(this.table, this.pages.bytes, exports, translation),
    };
  }
  async #foreignBatch(): Promise<void> {
    for (const [page, entries] of this.#foreignQueue.take()) {
      const start = page * PageBytes,
        pages = this.pages.snapshots(start, start + PageBytes + PageBytes);
      const compiled = await this.#compile(
        this.#job([{ start, end: start + PageBytes }], entries, pages),
      );
      if (this.#closed) return;
      const slot = compiled?.slots.length === 1 ? compiled.slots[0] : undefined;
      if (slot !== undefined && this.#foreign.set(page, slot)) this.statistics.foreignPages++;
    }
  }
  /** Drops every module so the engine can free its code; hot functions translate again. */
  #flush(): void {
    this.#epoch++;
    this.#index.clear();
    this.#translated.clear();
    this.#replay.length = 0;
    this.#planned.clear();
    this.#foreign.clear();
    this.#foreignQueue.clear();
    for (let slot = 0; slot < this.table.length; slot++) this.table.set(slot, null);
    this.#budget.release();
    this.statistics.flushes++;
  }
  async #batch(): Promise<void> {
    if (this.#budget.exceeded) this.#flush();
    if (this.#foreignQueue.size) await this.#foreignBatch();
    const replay = this.#replay.shift();
    if (replay) return this.#install(replay, true);
    const executable = this.#executable;
    if (!executable) return;
    const ranges = collectBatch({
      queued: this.#queued,
      executable,
      handled: (start) => this.#handled(start),
      readWord: (address) => this.pages.word(address),
      limits: Batch,
    });
    this.statistics.pendingFunctions = this.#queued.size;
    if (ranges.length)
      await this.#install(this.#job(ranges, this.#profile.entriesOf(ranges), []), false);
  }
  /** Compiles a job and points the index at its functions; replayed functions retranslated meanwhile are skipped. */
  async #install(job: TranslationJob, replay: boolean): Promise<void> {
    const compiled = await this.#compile(job);
    if (!compiled) {
      for (const range of job.functions)
        if (!this.#closed && (!replay || this.#planned.delete(range.start)))
          this.#queued.add(range.start);
      return;
    }
    compiled.translation.functions.forEach((translated, offset) => {
      if (replay && !this.#planned.delete(translated.start)) return;
      this.#index.set(translated, (compiled.slots[offset] ?? -1) + 1);
      this.#translated.add(translated.start);
      this.#profile.record(translated.start);
    });
    this.statistics.batches++;
    this.statistics.translatedFunctions = this.#translated.size;
    this.#profile.scheduleSave(this.#options.onProfile, PROFILE_SAVE_MS);
  }
  /** Drops translations covering written guest memory; later entries retranslate from new bytes. */
  invalidate(address: number, length: number): void {
    const end = address + length;
    for (let page = pageOf(address); page <= pageOf(end - 1); page++)
      if (this.#foreign.remove(page)) {
        this.#foreignQueue.forget(page);
        this.statistics.invalidations++;
      }
    const executable = this.#executable;
    if (!executable || end <= executable.codeStart || address >= executable.codeEnd) return;
    this.#epoch++;
    for (const snapshot of this.pages.snapshots(
      Math.max(address, executable.codeStart),
      Math.min(end, executable.codeEnd),
    ))
      this.#translator.patch(snapshot);
    for (const range of executable.ranges) {
      const start = range.start & ~THUMB_BIT;
      if (range.end <= address || start >= end || !this.#translated.has(range.start)) continue;
      this.#index.set(range, 0);
      this.#translated.delete(range.start);
      this.statistics.invalidations++;
    }
  }
  close(): void {
    this.#closed = true;
    this.#profile.flush(this.#options.onProfile);
    this.#translator.close();
    this.pages.close();
    this.#budget.release();
    for (const allocation of this.#allocations) this.#module._free(allocation);
    this.#allocations.length = 0;
  }
}
