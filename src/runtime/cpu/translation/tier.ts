import { PageBytes, StateBytes, StopState, stateLayout, type StateLayout } from "./layout";
import { translate, type FunctionRange, type Translation } from "./translate";
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
  #translate(
    functions: readonly FunctionRange[],
    entries: readonly number[],
    isCode: (address: number) => boolean,
  ): Translation {
    return translate({
      functions,
      readWord: (address) => this.pages.word(address),
      isCode,
      entries,
      stopPC: STOP_PC,
      layout: this.#layout,
      labelAddress: (range) =>
        this.#allocate(HALFWORD_BYTES * (range.end - (range.start & ~THUMB_BIT)), Alignment.Index),
    });
  }
  async #instantiate(translation: Translation): Promise<WebAssembly.Exports | undefined> {
    const compiled = performance.now();
    const { instance } = await WebAssembly.instantiate(translation.wasm, {
      env: { memory: this.#memory, table: this.table },
    });
    this.statistics.compileMs += performance.now() - compiled;
    this.statistics.wasmBytes += translation.wasm.length;
    return this.#closed ? undefined : instance.exports;
  }
  #install(exports: WebAssembly.Exports, translation: Translation): number[] {
    const first = this.table.grow(translation.functions.length);
    return translation.functions.map((translated, offset) => {
      const exported = exports[translated.exportName];
      if (typeof exported !== "function")
        throw new Error(`Missing translated export ${translated.exportName}.`);
      this.table.set(first + offset, exported);
      const labels = translated.labels;
      this.pages.bytes.set(
        new Uint8Array(labels.buffer, labels.byteOffset, labels.byteLength),
        translated.labelAddress,
      );
      return first + offset;
    });
  }
  async #foreignBatch(): Promise<void> {
    const pages = [...this.#foreignQueued];
    this.#foreignQueued.clear();
    for (const page of pages) {
      const start = page * PageBytes,
        entries = [...(this.#foreignEntries.get(page) ?? [])];
      const translation = this.#translate(
        [{ start, end: start + PageBytes }],
        entries,
        () => false,
      );
      const exports = await this.#instantiate(translation);
      if (!exports) return;
      if (translation.functions.length !== 1) continue;
      const [slot] = this.#install(exports, translation);
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
    const began = performance.now();
    const translation = this.#translate(
      ranges,
      ranges.flatMap((range) => [...(this.#extraEntries.get(range.start) ?? [])]),
      (address) => address >= executable.codeStart && address < executable.codeEnd,
    );
    this.statistics.translateMs += performance.now() - began;
    this.statistics.unsupported += translation.statistics.unsupported;
    const exports = await this.#instantiate(translation);
    if (!exports) return;
    const slots = this.#install(exports, translation),
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
  stopped(): number {
    return this.pages.view.getUint32(this.#layout.stopped, true);
  }
  resetStop(budget: number): void {
    const view = this.pages.view;
    view.setUint32(this.#layout.stopped, StopState.Running, true);
    view.setInt32(this.#layout.budget, budget, true);
  }
  close(): void {
    this.#closed = true;
    this.pages.close();
    for (const allocation of this.#allocations) this.#module._free(allocation);
    this.#allocations.length = 0;
  }
}
