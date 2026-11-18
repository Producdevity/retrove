/** The parts of the SQLite WebAssembly module Retrove uses. */
export interface SqliteModule {
  readonly wasm: {
    readonly exports: Record<string, unknown>;
    heap8u(): Uint8Array;
    alloc(bytes: number): number;
    dealloc(pointer: number): void;
  };
}
export default function sqlite3InitModule(options?: Record<string, unknown>): Promise<SqliteModule>;
