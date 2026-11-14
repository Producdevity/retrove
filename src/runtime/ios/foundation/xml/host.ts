import type { FoundationHost, HostResult } from "../../objc/host";
import type { XMLEvent, XMLSettings } from "./types";
export interface XMLHost extends FoundationHost {
  dataLength(pointer: number): number;
  readData(pointer: number, length: number): Uint8Array;
  data(bytes: Uint8Array): number;
  dictionary(attributes: Readonly<Record<string, string>>): number;
  error(code: number, domain: string): number;
  send(pointer: number, selector: string, args: number[], optional?: boolean): Promise<HostResult>;
  diagnostic(message: string, code: number): void;
}
export type XMLBackend = (bytes: Uint8Array, settings: XMLSettings) => Iterable<XMLEvent>;
