import type { GuestArguments } from "../../ios/objc/host";
export const AudioFileStatus = {
  Parameter: -50,
  Memory: -108,
  NotOpen: -38,
  EndOfFile: -39,
  Position: -40,
  NotFound: -43,
  IO: -36,
  Invalid: 0x6474613f,
  Operation: 0x6f703f3f,
  Permissions: 0x70726d3f,
} as const;
export const AUDIO_READ_CHUNK_BYTES = 65536;
export interface AudioSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  close?(): Promise<void>;
}
export interface AudioFileRecord {
  props: ReadonlyMap<number, Uint8Array>;
  dataAt: number;
  dataSize: number;
  count: number;
  packetBytes: number;
  offsets?: Float64Array;
  frames?: Uint32Array;
  read(offset: number, length: number): Promise<Uint8Array>;
  close?: () => Promise<void>;
}
export type AudioFileImport = (args: GuestArguments) => number | Promise<number>;
export class AudioFileError extends Error {
  constructor(readonly osStatus: number) {
    super("AudioFile OSStatus " + osStatus);
  }
}
export function audioStatus(error: unknown): number | undefined {
  return typeof error === "object" &&
    error !== null &&
    "osStatus" in error &&
    typeof error.osStatus === "number"
    ? error.osStatus
    : undefined;
}
