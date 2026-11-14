import type { FoundationHost, HostResult } from "../../objc/host";
import type { ArchiveGraph, ArchiveFields } from "../../foundation/archives/graph";
import type { IpaArchive } from "../../../../../web/ipa.mjs";
export interface NibHost extends FoundationHost {
  send(self: number, selector: string, args?: number[], optional?: boolean): Promise<HostResult>;
  items(pointer: number): number[];
  openArchive(source: ArchiveFields): { pointer: number; graph: ArchiveGraph };
  setOutlet(self: number, key: string, value: number): Promise<void>;
  readonly ipa: Pick<IpaArchive, "bundlePath" | "info" | "has" | "read">;
}
