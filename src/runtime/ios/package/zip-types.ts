export interface ZipEntry {
  readonly path: string;
  readonly size: number;
  readonly compressedSize: number;
  readonly method: number;
  readonly crc: number;
  readonly offset: number;
  readonly modified: number;
  readonly flags: number;
}
export type Diagnostic = (
  level: "debug" | "info" | "warn" | "error",
  area: string,
  message: string,
  details?: unknown,
) => void;
export interface ReadOptions {
  maxBytes?: number;
  onProgress?: (offset: number) => void;
}
export interface ZipArchive {
  readonly entries: Map<string, ZipEntry>;
  readonly directories: Set<string>;
  has: (path: string) => boolean;
  read: (path: string, options?: ReadOptions) => Promise<Uint8Array<ArrayBuffer>>;
  assetBlob: (path: string) => Promise<Blob>;
  compressedBlob: (path: string) => Promise<Blob>;
  stream: (path: string) => Promise<ReadableStream<Uint8Array<ArrayBuffer>>>;
}
export interface IpaArchive extends ZipArchive {
  readonly info: Record<string, unknown>;
  readonly bundlePath: string;
  readonly executablePath: string;
  readExecutable: () => Promise<Uint8Array<ArrayBuffer>>;
}
