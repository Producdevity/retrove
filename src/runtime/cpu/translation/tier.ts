import { PageBytes, StateBytes, stateLayout, type StateLayout } from "./layout";
import type { FunctionRange, Translation } from "./translate";
import { buildJob, runJob, type CodeSnapshot, type TranslationJob } from "./translation-job";
import { Translator } from "./translator";
import { installTranslation, instantiateTranslation } from "./install";
import { GuestPages, type HostHeap } from "./guest-pages";
import { ForeignPages, FOREIGN_SLOTS } from "./foreign-pages";
import { discoverExecutable, functionAt, type Executable } from "./executable";
import { calleeStarts } from "./callees";
import { emptyStatistics, recordError, type TierStatistics } from "./tier-statistics";

export type { TierStatistics } from "./tier-statistics";

export interface TierModule extends HostHeap {
  getTciMemory(): WebAssembly.Memory;
}
const Alignment = { State: 64, Table: 4096, Index: 16 } as const;
const Batch = { Instructions: 60_000, Functions: 400 } as const;
const MAX_EXTRA_ENTRIES = 64;
const WORD_BYTES = 4;
const HALFWORD_BYTES = 2;
const THUMB_BIT = 1;
/** The emitted code exits to this PC when it stops; it is never a valid guest instruction address. */
const STOP_PC = 1;
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
  readonly #extraEntries = new Map<number, Set<number>>();
  readonly #foreignEntries = new Map<number, Set<number>>();
  readonly #foreignQueued = new Set<number>();
  #executable: Executable | undefined;
  #discovered = false;
  #working = false;
  #closed = false;
  /** Bumped when executable code is written, so in-flight jobs built from older bytes are dropped. */
  #epoch = 0;
  readonly #translator = new Translator((job) =>
    runJob(job, (address) => this.pages.word(address)),
  );
  constructor(module: TierModule) {
    this.#module = module;
    this.#memory = module.getTciMemory();
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
  #allocate(bytes: number, alignment: number): number {
    const raw = this.#module._malloc(bytes + alignment);
    if (!raw) throw new Error("Unable to allocate translated-code memory.");
    this.#allocations.push(raw);
    const aligned = Math.ceil(raw / alignment) * alignment;
    this.#module.HEAPU8.fill(0, aligned, aligned + bytes);
    return aligned;
  }
  #indexAddress(address: number): number {
    return this.#layout.index.base + HALFWORD_BYTES * (address - this.#layout.index.start);
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
    const base = this.#allocate(HALFWORD_BYTES * span, Alignment.Index);
    this.#layout = {
      ...this.#layout,
      index: { base, start: executable.codeStart, end: executable.codeEnd },
    };
    for (const snapshot of this.pages.snapshots(executable.codeStart, executable.codeEnd))
      this.#translator.setCode(snapshot);
  }
  /** Function table slot + 1 for a guest PC, 0 when not translated. */
  entry(pc: number): number {
    const index = this.#layout.index,
      address = pc & ~THUMB_BIT;
    if (address >= index.start && address < index.end)
      return this.pages.view.getUint32(this.#indexAddress(address), true);
    if (pc & (WORD_BYTES - 1)) return 0;
    return this.#foreign.entry(pageOf(pc));
  }
  /** Retranslates the function containing `pc` with `pc` as an extra entry label. */
  discoveredEntry(pc: number): void {
    const range = functionAt(this.#executable, pc);
    if (!range) return;
    const entries = this.#extraEntries.get(range.start) ?? new Set<number>();
    if (entries.has(pc) || entries.size > MAX_EXTRA_ENTRIES) return;
    entries.add(pc);
    this.#extraEntries.set(range.start, entries);
    this.#translated.delete(range.start);
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
      this.#noteForeign(pc);
      return;
    }
    const range = functionAt(executable, pc);
    if (!range || this.#translated.has(range.start) || this.#queued.has(range.start)) return;
    this.#queued.add(range.start);
    this.statistics.pendingFunctions = this.#queued.size;
    this.#schedule();
  }
  #noteForeign(pc: number): void {
    const page = pageOf(pc),
      entries = this.#foreignEntries.get(page) ?? new Set<number>();
    if (entries.has(pc)) return;
    entries.add(pc);
    this.#foreignEntries.set(page, entries);
    this.#foreignQueued.add(page);
    this.#schedule();
  }
  #schedule(): void {
    if (this.#working || this.#closed || (!this.#queued.size && !this.#foreignQueued.size)) return;
    this.#working = true;
    setTimeout(() => {
      this.#batch()
        .catch((error: unknown) => {
          recordError(this.statistics, error);
        })
        .finally(() => {
          this.#working = false;
          this.#schedule();
        });
    }, 0);
  }
  #job(
    functions: readonly FunctionRange[],
    entries: readonly number[],
    pages: readonly CodeSnapshot[],
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
      allocate: (bytes) => this.#allocate(bytes, Alignment.Index),
    });
  }
  /** Translates and compiles a job; undefined when the tier closed or code changed meanwhile. */
  async #compile(
    job: TranslationJob,
  ): Promise<{ translation: Translation; slots: number[] } | undefined> {
    const epoch = this.#epoch,
      { translation, elapsedMs } = await this.#translator.translate(job);
    this.statistics.translateMs += elapsedMs;
    this.statistics.unsupported += translation.statistics.unsupported;
    const exports = await instantiateTranslation(
      translation,
      { memory: this.#memory, table: this.table },
      this.statistics,
    );
    if (this.#closed || epoch !== this.#epoch) return undefined;
    return {
      translation,
      slots: installTranslation(this.table, this.pages.bytes, exports, translation),
    };
  }
  async #foreignBatch(): Promise<void> {
    const pages = [...this.#foreignQueued];
    this.#foreignQueued.clear();
    for (const page of pages) {
      const start = page * PageBytes,
        entries = [...(this.#foreignEntries.get(page) ?? [])];
      const pages = this.pages.snapshots(start, start + PageBytes + PageBytes);
      const compiled = await this.#compile(
        this.#job([{ start, end: start + PageBytes }], entries, pages),
      );
      if (this.#closed) return;
      const slot = compiled?.slots.length === 1 ? compiled.slots[0] : undefined;
      if (slot !== undefined && this.#foreign.set(page, slot)) this.statistics.foreignPages++;
    }
  }
  #collect(): FunctionRange[] {
    const ranges: FunctionRange[] = [];
    let instructions = 0;
    const take = (start: number, callee: boolean): void => {
      const range = functionAt(this.#executable, start);
      if (
        !range ||
        this.#translated.has(range.start) ||
        ranges.some((r) => r.start === range.start)
      )
        return;
      ranges.push(range);
      instructions += (range.end - range.start) / WORD_BYTES;
      this.#queued.delete(range.start);
      if (callee || range.start & THUMB_BIT) return;
      for (const target of calleeStarts(range, (address) => this.pages.word(address))) {
        if (ranges.length >= Batch.Functions) break;
        take(target, true);
      }
    };
    for (const start of [...this.#queued]) {
      if (ranges.length >= Batch.Functions || instructions >= Batch.Instructions) break;
      take(start, false);
    }
    this.statistics.pendingFunctions = this.#queued.size;
    return ranges;
  }
  async #batch(): Promise<void> {
    if (this.#foreignQueued.size) await this.#foreignBatch();
    const ranges = this.#collect(),
      executable = this.#executable;
    if (!ranges.length || !executable) return;
    const entries = ranges.flatMap((range) => [...(this.#extraEntries.get(range.start) ?? [])]);
    const compiled = await this.#compile(this.#job(ranges, entries, []));
    if (!compiled) {
      if (!this.#closed) for (const range of ranges) this.#queued.add(range.start);
      return;
    }
    const { translation, slots } = compiled,
      view = this.pages.view;
    translation.functions.forEach((translated, offset) => {
      const slot = (slots[offset] ?? -1) + 1;
      for (
        let address = translated.start & ~THUMB_BIT;
        address < translated.end;
        address += HALFWORD_BYTES
      )
        view.setUint32(this.#indexAddress(address), slot, true);
      this.#translated.add(translated.start);
    });
    this.statistics.batches++;
    this.statistics.translatedFunctions = this.#translated.size;
  }
  /** Drops translations covering written guest memory; later entries retranslate from new bytes. */
  invalidate(address: number, length: number): void {
    const end = address + length;
    for (let page = pageOf(address); page <= pageOf(end - 1); page++)
      if (this.#foreign.remove(page)) {
        this.#foreignEntries.delete(page);
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
    const view = this.pages.view;
    for (const range of executable.ranges) {
      const start = range.start & ~THUMB_BIT;
      if (range.end <= address || start >= end || !this.#translated.has(range.start)) continue;
      for (let at = start; at < range.end; at += HALFWORD_BYTES)
        view.setUint32(this.#indexAddress(at), 0, true);
      this.#translated.delete(range.start);
      this.statistics.invalidations++;
    }
  }
  close(): void {
    this.#closed = true;
    this.#translator.close();
    this.pages.close();
    for (const allocation of this.#allocations) this.#module._free(allocation);
    this.#allocations.length = 0;
  }
}
