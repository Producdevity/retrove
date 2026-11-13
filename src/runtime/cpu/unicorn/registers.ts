interface RegisterModule {
  readonly HEAPU32: Uint32Array;
  readonly ERR_OK: number;
  _malloc(bytes: number): number;
  _free(address: number): void;
  _uc_reg_read(engine: number, register: number, destination: number): number;
  _uc_reg_write(engine: number, register: number, source: number): number;
  strerror(status: number): string;
}
const WORD_BYTES = 4;
export class UnicornRegisters {
  readonly #module: RegisterModule;
  readonly #engine: number;
  readonly #cell: number;
  #closed = false;
  constructor(module: RegisterModule, engine: number) {
    this.#module = module;
    this.#engine = engine;
    this.#cell = module._malloc(WORD_BYTES);
    if (!this.#cell) throw new Error("Unable to allocate the CPU register transfer cell.");
  }
  #check(status: number): void {
    if (status !== this.#module.ERR_OK)
      throw new Error(`Guest register access failed: ${this.#module.strerror(status)}`);
  }
  #requireOpen(): void {
    if (this.#closed) throw new Error("CPU register access is closed.");
  }
  read(register: number): number {
    this.#requireOpen();
    this.#check(this.#module._uc_reg_read(this.#engine, register, this.#cell));
    const value = this.#module.HEAPU32[this.#cell / WORD_BYTES];
    if (value === undefined) throw new Error("CPU register transfer cell is outside memory.");
    return value;
  }
  write(register: number, value: number): void {
    this.#requireOpen();
    this.#module.HEAPU32[this.#cell / WORD_BYTES] = value;
    this.#check(this.#module._uc_reg_write(this.#engine, register, this.#cell));
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#module._free(this.#cell);
  }
}
