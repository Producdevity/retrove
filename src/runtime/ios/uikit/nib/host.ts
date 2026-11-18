import type { FoundationHost, HostResult } from "../../objc/host";
import type { ArchiveGraph } from "../../foundation/archives/graph";
import type { IpaArchive } from "../../../../../web/ipa.mjs";
export interface NibHost extends FoundationHost {
  send(self: number, selector: string, args?: number[], optional?: boolean): Promise<HostResult>;
  items(pointer: number): number[];
  openArchive(source: unknown): { pointer: number; graph: ArchiveGraph };
  /** Parses a property list; older nibs are binary-plist keyed archives. */
  parse(bytes: Uint8Array): unknown;
  setOutlet(self: number, key: string, value: number): Promise<void>;
  /** The registered selector for a method name. */
  selector(name: string): number;
  readonly ipa: Pick<IpaArchive, "bundlePath" | "info" | "has" | "read">;
}
