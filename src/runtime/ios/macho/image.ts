import type { Binding } from "./fixups";
import type { Segment } from "./segment";

export interface SymbolMatch {
  name: string;
  offset: number;
}
export interface ImageTables {
  bytes: Uint8Array;
  segments: Segment[];
  initializers: number[];
  dylibs: string[];
  imports: Binding[];
  rebases: number[];
  subtype: number;
}
export interface MachOImage extends ImageTables {
  entry: number;
  entryKind: "main" | "thread";
  findExport(name: string): number | null;
  symbolAt(target: number): SymbolMatch | undefined;
}
