import type { DirectoryEntry } from "../file-metadata";
import type { BlockSource } from "../../../storage/bundle-blocks";
import type { HostWait } from "../guest-imports";

export interface BundleEntry {
  readonly size: number;
  readonly modified?: number;
}
export interface BundleArchive {
  readonly bundlePath: string;
  readonly executablePath?: string;
  readonly info?: Readonly<Record<string, unknown>>;
  readonly entries?: ReadonlyMap<string, BundleEntry>;
  readonly directories?: Iterable<string>;
  has(path: string): boolean;
  read(path: string): Promise<Uint8Array>;
  assetBlob?(path: string): Promise<Blob>;
}
export type DiagnosticSink = (
  level: "debug" | "info" | "warn" | "error",
  area: string,
  message: string,
  details?: unknown,
) => void;
export type Located =
  | { readonly home: string; readonly bundle?: undefined }
  | { readonly bundle: string; readonly home?: undefined };
export type TransferResult = number | HostWait;
export interface DescriptorDevice {
  read(pointer: number, count: number): TransferResult | Promise<TransferResult>;
  write(pointer: number, count: number): TransferResult | Promise<TransferResult>;
  close(): void | Promise<void>;
}
export interface LargeAsset {
  references: number;
  readonly path: string;
  readonly load: () => Promise<Blob>;
  blob?: Promise<Blob>;
  source?: BlockSource;
}
export interface OpenFile {
  mode: number;
  offset: number;
  append: boolean;
  path?: string | undefined;
  bundle?: string;
  asset?: LargeAsset;
  data?: Uint8Array;
  inode?: number;
  device?: DescriptorDevice;
  closeOnExec?: boolean;
  nonblocking?: boolean;
}
export interface GuestStream {
  fd: number;
  flags: number;
  eof: boolean;
  error: boolean;
  pushback?: number | undefined;
}
export interface DirectoryStream {
  readonly entries: readonly DirectoryEntry[];
  position: number;
}
