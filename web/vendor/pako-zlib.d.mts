export class ZStream {
  input: Uint8Array | null;
  next_in: number;
  avail_in: number;
  total_in: number;
  output: Uint8Array | null;
  next_out: number;
  avail_out: number;
  total_out: number;
  msg: string;
  state: unknown;
  data_type: number;
  adler: number;
}
export function inflateInit2(stream: ZStream, windowBits: number): number;
export function inflate(stream: ZStream, flush: number): number;
export function inflateEnd(stream: ZStream): number;
export function deflateInit2(
  stream: ZStream,
  level: number,
  method: number,
  windowBits: number,
  memLevel: number,
  strategy: number,
): number;
export function deflate(stream: ZStream, flush: number): number;
export function deflateEnd(stream: ZStream): number;
