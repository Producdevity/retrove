export interface ZipEntry { readonly path: string; readonly size: number; readonly compressedSize: number; readonly method: number; readonly crc: number; readonly offset: number; readonly modified: number; readonly flags: number }
export interface IpaArchive {
  readonly info: Record<string, unknown>;
  readonly entries: Map<string, ZipEntry>;
  readonly directories: Set<string>;
  readonly bundlePath: string;
  readonly executablePath: string;
  has(path: string): boolean;
  read(path: string, options?: { maxBytes?: number; onProgress?: (offset: number) => void }): Promise<Uint8Array<ArrayBuffer>>;
  readExecutable(): Promise<Uint8Array<ArrayBuffer>>;
  assetBlob(path: string): Promise<Blob>;
  compressedBlob(path: string): Promise<Blob>;
  stream(path: string): Promise<ReadableStream<Uint8Array<ArrayBuffer>>>;
}
export type Diagnostic = (level: "debug" | "info" | "warn" | "error", area: string, message: string, details?: unknown) => void;
export function openIPA(blob: Blob, diagnostic?: Diagnostic): Promise<IpaArchive>;
export function parsePlist(bytes: Uint8Array): unknown;

export function openZip(blob: Blob, diagnostic?: Diagnostic): Promise<Omit<IpaArchive, "info" | "bundlePath" | "executablePath" | "readExecutable">>;
