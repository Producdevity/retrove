import { MaxCodeBytes, PageBytes, stateLayout, type StateLayout } from "./layout";
import { runJob, type TranslationJob } from "./translation-job";
import { Translator } from "./translator";
import { ModuleInstaller } from "./module-installer";
import { demandAt } from "./code-range";
import { GuestPages } from "./guest-pages";
import { ForeignPages, ForeignQueue, FOREIGN_SLOTS, PageEntries } from "./foreign-pages";
import { discoverExecutable, functionAt, type Executable } from "./executable";
import { emptyStatistics, recordError, type TierStatistics } from "./tier-statistics";
import { collectBatch } from "./collect";
import { HotFunctions } from "./hot-functions";
import { CodeBudget } from "./code-budget";
import { FunctionIndex } from "./function-index";
import { moduleSlot } from "./translation-store";
import { ProfileRecorder, profileBatches } from "./translation-profile";
import { Batch, Coalesce, PROFILE_SAVE_MS, replayLimits } from "./tier-options";
import { LabelAreas } from "./label-areas";
import { AheadOfTime, AOT_HOT_ENTRIES, translationAheadEnabled } from "./aot";
import { TierJobs } from "./tier-jobs";
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
  /** State block, tables and index addresses that translated code and the runner use. */
  layout: StateLayout;
  readonly #foreign: ForeignPages;
  readonly #labels: LabelAreas;
  readonly #jobs: TierJobs;
  #aot: AheadOfTime | undefined;
  readonly #modules: ModuleInstaller;
  readonly #translated = new Set<number>();
  readonly #queued = new Set<number>();
  readonly #hot = new HotFunctions();
  readonly #aotHot = new HotFunctions(AOT_HOT_ENTRIES);
  readonly #budget: CodeBudget;
  readonly #index = new FunctionIndex(
    () => this.pages.view,
    () => this.layout.index,
  );
  /** Profiled functions whose replay job is built but not installed yet. */
  readonly #planned = new Set<number>();
  readonly #replay: TranslationJob[] = [];
  readonly #profile: ProfileRecorder;
  readonly #options: TierOptions;
  readonly #foreignQueue = new ForeignQueue();
  /** Entries seen on each code page outside the executable, for pages translated on demand. */
  readonly #foreignEntries = new PageEntries((start, end) => this.pages.snapshots(start, end));
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
    this.#options = options;
    this.#profile = new ProfileRecorder(options.profile);
    const memory = module.getTciMemory();
    this.#budget = new CodeBudget(options.codeBudget);
    this.pages = new GuestPages(module, memory);
    const { arena, region } = this.pages,
      foreign = arena + region.foreign;
    this.#labels = new LabelAreas(arena, region);
    this.#jobs = new TierJobs(
      () => this.layout,
      () => this.#executable,
    );
    this.#modules = new ModuleInstaller({
      memory,
      table: this.table,
      pages: this.pages,
      labels: this.#labels,
      budget: this.#budget,
      statistics: this.statistics,
      translator: this.#translator,
    });
    this.#foreign = new ForeignPages(foreign, () => this.pages.view);
    this.layout = {
      ...stateLayout(arena + region.state, this.pages, {
        base: arena + region.index,
        start: 0,
        end: 0,
      }),
      foreign: { base: foreign, slots: FOREIGN_SLOTS },
    };
    this.statistics.translator = this.#translator.kind;
  }
  #discover(): void {
    this.#discovered = true;
    const executable = discoverExecutable(this.pages.regions, this.pages.reader);
    if (!executable || executable.codeEnd - executable.codeStart > MaxCodeBytes) return;
    this.#executable = executable;
    const base = this.pages.arena + this.pages.region.index;
    this.layout = {
      ...this.layout,
      index: { base, start: executable.codeStart, end: executable.codeEnd },
    };
    for (const snapshot of this.pages.snapshots(executable.codeStart, executable.codeEnd))
      this.#translator.setCode(snapshot);
    const cache = this.#options.cache;
    if (cache && this.#options.ahead !== false && translationAheadEnabled())
      this.#startAot(executable, cache);
    if (!this.#options.profile) return;
    profileBatches(this.#options.profile, executable, replayLimits(this.#budget.limit)).forEach(
      (functions, index) => {
        const slot = cache && moduleSlot(cache, index);
        this.#replay.push(
          this.#jobs.build(functions, this.#profile.entriesOf(functions), [], slot),
        );
        for (const range of functions) this.#planned.add(range.start);
      },
    );
    this.statistics.replayModules = this.#replay.length;
    this.#schedule();
  }
  readonly #handled = (start: number) => this.#translated.has(start) || this.#planned.has(start);
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
    if (!range || this.#handled(range.start) || this.#queued.has(range.start)) return;
    if (this.#aotHot.enter(range.start) && this.#aot?.request(range.start)) return this.#schedule();
    if (!this.#hot.enter(range.start)) return;
    this.#queued.add(range.start);
    this.statistics.pendingFunctions = this.#queued.size;
    this.#schedule();
  }

  #startAot(executable: Executable, app: string): void {
    this.#aot = new AheadOfTime(executable, app, {
      job: (functions, key) =>
        this.#jobs.build(functions, this.#profile.entriesOf(functions), [], key),
      prepare: (job) => this.#translator.prepare(job),
      busy: () => this.#working || this.#replay.length > 0 || this.#queued.size > 0,
      closed: () => this.#closed,
      progress: (aotPrepared, aotChunks) =>
        Object.assign(this.statistics, { aotPrepared, aotChunks }),
    });
    void this.#aot.start();
  }
  #schedule(): void {
    const waiting =
      this.#queued.size + this.#foreignQueue.size + this.#replay.length + (this.#aot?.waiting ?? 0);
    if (this.#working || this.#closed || !waiting) return;
    this.#working = true;
    const urgent =
      this.#replay.length || this.#aot?.waiting || this.#queued.size >= Coalesce.Functions;
    const run = async (): Promise<void> => {
      await this.#batch().catch((error: unknown) => recordError(this.statistics, error));
      this.#working = false;
      this.#schedule();
    };
    setTimeout(() => void run(), urgent ? 0 : Coalesce.DelayMs);
  }

  async #foreignBatch(): Promise<void> {
    for (const [page, entries] of this.#foreignQueue.take()) {
      const start = page * PageBytes,
        pages = this.pages.snapshots(start, start + PageBytes + PageBytes);
      const compiled = await this.#compile(
        this.#jobs.build([{ start, end: start + PageBytes }], entries, pages),
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
    this.#labels.reset();
    this.#aot?.suspend();
    this.#foreignQueue.clear();
    this.#foreignEntries.clear();
    for (let slot = 0; slot < this.table.length; slot++) this.table.set(slot, null);
    this.#budget.release();
    this.statistics.flushes++;
  }
  async #batch(): Promise<void> {
    if (this.#budget.exceeded || this.#labels.crowded) this.#flush();
    if (this.#foreignQueue.size) await this.#foreignBatch();
    const replay = this.#replay.shift();
    if (replay) return this.#install(replay, true);
    const chunk = this.#aot?.take();
    if (chunk) return this.#install(chunk, false, false);
    const executable = this.#executable;
    if (!executable) return;
    const ranges = collectBatch({
      queued: this.#queued,
      executable,
      handled: this.#handled,
      readWord: (address) => this.pages.word(address),
      limits: Batch,
    });
    this.statistics.pendingFunctions = this.#queued.size;
    if (ranges.length)
      await this.#install(this.#jobs.build(ranges, this.#profile.entriesOf(ranges), []), false);
  }
  /** Compiles a job and points the index at its functions; replayed functions retranslated meanwhile are skipped. */
  #compile(job: TranslationJob) {
    const epoch = this.#epoch;
    return this.#modules.compile(job, () => !this.#closed && epoch === this.#epoch);
  }
  async #install(job: TranslationJob, replay: boolean, record = true): Promise<void> {
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
      if (record) this.#profile.record(translated.start);
    });
    this.statistics.batches++;
    this.statistics.translatedFunctions = this.#translated.size;
    this.#profile.scheduleSave(this.#options.onProfile, PROFILE_SAVE_MS);
  }
  /**
   * Translates and installs the code at `pc` on the calling thread, for an engine with no
   * interpreter to run it meanwhile. False when nothing was installed for `pc`.
   */
  translateNow(pc: number): boolean {
    if (!this.#discovered) this.#discover();
    if (this.#budget.exceeded || this.#labels.crowded) this.#flush();
    const demand = demandAt(pc, this.#executable, this.#profile, this.#foreignEntries);
    if (!demand) return false;
    const { range } = demand,
      job = this.#jobs.build([demand.function], demand.entries, demand.pages);
    const [slot] = this.#modules.now(job).slots;
    if (slot === undefined) return false;
    if (!range) return this.#foreign.set(pageOf(pc), slot);
    this.#index.set(range, slot + 1);
    this.#translated.add(range.start);
    this.#profile.record(range.start);
    this.statistics.translatedFunctions = this.#translated.size;
    this.#profile.scheduleSave(this.#options.onProfile, PROFILE_SAVE_MS);
    return true;
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
  }
}
